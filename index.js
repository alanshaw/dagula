import { createLibp2p } from 'libp2p'
import { WebSockets } from '@libp2p/websockets'
import { TCP } from '@libp2p/tcp'
import { Noise } from '@chainsafe/libp2p-noise'
import { Mplex } from '@libp2p/mplex'
import { Multiaddr } from '@multiformats/multiaddr'
import defer from 'p-defer'
import debug from 'debug'
import * as raw from 'multiformats/codecs/raw'
import * as dagPb from '@ipld/dag-pb'
import * as dagCbor from '@ipld/dag-cbor'
import * as dagJson from '@ipld/dag-json'
import * as Block from 'multiformats/block'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import { exporter } from 'ipfs-unixfs-exporter'
import { BitswapFetcher } from './bitswap-fetcher.js'
import { CID } from 'multiformats'

/**
 * @typedef {{ get: (cid: import('multiformats').CID) => Promise<Uint8Array>}} Blockstore
 * @typedef {{ libp2p: import('libp2p').Libp2p, blockstore: Blockstore }} Components
 */

const BITSWAP_PROTOCOL = '/ipfs/bitswap/1.2.0'
const DEFAULT_PEER = new Multiaddr('/dns4/peer.ipfs-elastic-provider-aws.com/tcp/3000/ws/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm')

const log = debug('dagular')

const Codecs = {
  [raw.code]: raw,
  [dagPb.code]: dagPb,
  [dagCbor.code]: dagCbor,
  [dagJson.code]: dagJson
}

export class Dagula {
  /** @type {Promise<Components>?} */
  #components = null

  /** @type {Multiaddr} */
  #peer = null

  /**
   * @param {Multiaddr|string} peer
   */
  constructor (peer) {
    peer = typeof peer === 'string' ? new Multiaddr(peer) : peer
    this.#peer = peer || DEFAULT_PEER
  }

  async #getComponents () {
    if (this.#components) return this.#components
    /** @type {import('p-defer').DeferredPromise<Components>} */
    const { promise, resolve, reject } = defer()
    this.#components = promise

    try {
      log('creating libp2p node')
      const libp2p = await createLibp2p({
        transports: [new WebSockets(), new TCP()],
        streamMuxers: [new Mplex({ maxMsgSize: 4 * 1024 * 1024 })],
        connectionEncryption: [new Noise()]
      })

      const bitswap = new BitswapFetcher(async () => {
        log('new stream to %s', this.#peer)
        const { stream } = await libp2p.dialProtocol(this.#peer, BITSWAP_PROTOCOL)
        return stream
      })

      // incoming blocks
      await libp2p.handle(BITSWAP_PROTOCOL, bitswap.handler)

      log('starting libp2p node')
      await libp2p.start()

      resolve({ libp2p, blockstore: bitswap })
    } catch (err) {
      reject(err)
    }

    return promise
  }

  /**
   * @param {import('multiformats').CID|string} cid
   */
  async * get (cid) {
    cid = typeof cid === 'string' ? CID.parse(cid) : cid
    log('getting DAG %s', cid)
    const { blockstore } = await this.#getComponents()
    let cids = [cid]
    while (true) {
      log('fetching %d CIDs', cids.length)
      const blocks = await Promise.all(cids.map(cid => blockstore.get(cid)))
      const nextCids = []
      for (const [i, bytes] of blocks.entries()) {
        const cid = cids[i]
        yield { cid, bytes }
        const codec = Codecs[cid.code]
        if (!codec) throw new Error(`unknown codec: ${cid.code}`)
        log('decoding block %s', cid)
        const block = await Block.decode({ bytes, codec, hasher })
        for (const [, cid] of block.links()) {
          nextCids.push(cid)
        }
      }
      if (!nextCids.length) break
      log('%d CIDs in links', nextCids.length)
      cids = nextCids
    }
  }

  /**
   * @param {import('multiformats').CID|string} cid
   */
  async getBlock (cid) {
    cid = typeof cid === 'string' ? CID.parse(cid) : cid
    log('getting block %s', cid)
    const { blockstore } = await this.#getComponents()
    return blockstore.get(cid)
  }

  /**
   * @param {string|import('multiformats').CID} path
   */
  async getUnixfs (path) {
    log('getting unixfs %s', path)
    const { blockstore } = await this.#getComponents()
    return exporter(path, blockstore)
  }

  async destroy () {
    if (!this.#components) return
    const { libp2p } = await this.#getComponents()
    return libp2p.stop()
  }
}
