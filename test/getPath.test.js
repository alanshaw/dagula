import test from 'ava'
import { fromString } from 'multiformats/bytes'
import * as raw from 'multiformats/codecs/raw'
import * as dagPB from '@ipld/dag-pb'
import * as dagCbor from '@ipld/dag-cbor'
import * as dagJson from '@ipld/dag-json'
import { UnixFS as UnixFSv1 } from 'ipfs-unixfs'
import * as UnixFS from '@ipld/unixfs'
import { TransformStream } from 'node:stream/web'
import { sha256 } from 'multiformats/hashes/sha2'
import { identity } from 'multiformats/hashes/identity'
import { CID } from 'multiformats/cid'
import * as Block from 'multiformats/block'
import { collect } from 'streaming-iterables'
import { Dagula } from '../index.js'
import { getLibp2p, fromNetwork } from '../p2p.js'
import { startBitswapPeer } from './_libp2p.js'
import { MemoryBlockstore } from './helpers/blockstore.js'

test('should getPath', async t => {
  // should return all blocks in path and all blocks for resolved target of path
  const filePart1 = await Block.encode({ codec: raw, value: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart2 = await Block.encode({ codec: raw, value: fromString(`EVEN MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const fileNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart1.cid },
        { Name: '1', Hash: filePart2.cid }
      ]
    }
  })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: fileNode.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([filePart1, filePart2, fileNode, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${dirNode.cid}/foo`)) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 4)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
  t.deepEqual(blocks.at(2).cid, filePart1.cid)
  t.deepEqual(blocks.at(2).bytes, filePart1.bytes)
  t.deepEqual(blocks.at(3).cid, filePart2.cid)
  t.deepEqual(blocks.at(3).bytes, filePart2.bytes)
})

test('should getPath through dag-cbor', async t => {
  // should return all blocks in path and all blocks for resolved target of path
  const fileNode = await Block.encode({ codec: raw, value: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })

  const cborRootNode = await Block.encode({
    codec: dagCbor,
    hasher: sha256,
    value: {
      foo: fileNode.cid,
      other: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn')
    }
  })

  const peer = await startBitswapPeer([fileNode, cborRootNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${cborRootNode.cid}/foo`)) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 2)
  t.deepEqual(blocks.at(0).cid, cborRootNode.cid)
  t.deepEqual(blocks.at(0).bytes, cborRootNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
})

test('should getPath through dag-json', async t => {
  // should return all blocks in path and all blocks for resolved target of path
  const fileNode = await Block.encode({ codec: raw, value: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })

  const jsonRootNode = await Block.encode({
    codec: dagJson,
    hasher: sha256,
    value: {
      foo: fileNode.cid,
      other: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn')
    }
  })

  const peer = await startBitswapPeer([fileNode, jsonRootNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${jsonRootNode.cid}/foo`)) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 2)
  t.deepEqual(blocks.at(0).cid, jsonRootNode.cid)
  t.deepEqual(blocks.at(0).bytes, new Uint8Array(jsonRootNode.bytes)) // in dag-json this is a Buffer instance in Nodejs
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
})

test('should getPath through identity encoded dag-cbor', async t => {
  // should return all blocks in path and all blocks for resolved target of path
  const fileNode = await Block.encode({ codec: raw, value: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })

  const identityCborRootNode = await Block.encode({
    codec: dagCbor,
    hasher: identity,
    value: {
      foo: fileNode.cid,
      other: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn')
    }
  })

  const peer = await startBitswapPeer([fileNode, identityCborRootNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${identityCborRootNode.cid}/foo`)) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 2)
  t.deepEqual(blocks.at(0).cid, identityCborRootNode.cid)
  t.deepEqual(blocks.at(0).bytes, identityCborRootNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
})

test('should getPath on file with dagScope=entity', async t => {
  // return all blocks in path and all blocks for resolved target of path
  const filePart1 = await Block.decode({ codec: raw, bytes: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart2 = await Block.decode({ codec: raw, bytes: fromString(`EVEN MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const fileNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart1.cid },
        { Name: '1', Hash: filePart2.cid }
      ]
    }
  })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: fileNode.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([filePart1, filePart2, fileNode, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })

  const blocks = []
  const dagScope = 'entity'
  for await (const entry of dagula.getPath(`${dirNode.cid}/foo`, { dagScope })) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 4)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
  t.deepEqual(blocks.at(2).cid, filePart1.cid)
  t.deepEqual(blocks.at(2).bytes, filePart1.bytes)
  t.deepEqual(blocks.at(3).cid, filePart2.cid)
  t.deepEqual(blocks.at(3).bytes, filePart2.bytes)
})

test('should getPath on large file with dagScope=entity, order=unk', async t => {
  // return all blocks in path and all blocks for resolved target of path
  const filePart1 = await Block.decode({ codec: raw, bytes: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart2 = await Block.decode({ codec: raw, bytes: fromString(`EVEN MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart3 = await Block.decode({ codec: raw, bytes: fromString(`SO MUCH TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart4 = await Block.decode({ codec: raw, bytes: fromString(`TEST DATA DOING THE MOST ${Date.now()}`), hasher: sha256 })
  const fileSubNode1 = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart1.cid },
        { Name: '1', Hash: filePart2.cid }
      ]
    }
  })
  const fileSubNode2 = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart3.cid },
        { Name: '1', Hash: filePart4.cid }
      ]
    }
  })

  const fileNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: fileSubNode1.cid },
        { Name: '1', Hash: fileSubNode2.cid }
      ]
    }
  })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: fileNode.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([filePart1, filePart2, filePart3, filePart4, fileSubNode1, fileSubNode2, fileNode, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })

  const blocks = []
  const dagScope = 'entity'
  const order = 'unk'
  for await (const entry of dagula.getPath(`${dirNode.cid}/foo`, { dagScope, order })) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 8)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
  t.deepEqual(blocks.at(2).cid, fileSubNode1.cid)
  t.deepEqual(blocks.at(2).bytes, fileSubNode1.bytes)
  t.deepEqual(blocks.at(3).cid, fileSubNode2.cid)
  t.deepEqual(blocks.at(3).bytes, fileSubNode2.bytes)
  t.deepEqual(blocks.at(4).cid, filePart1.cid)
  t.deepEqual(blocks.at(4).bytes, filePart1.bytes)
  t.deepEqual(blocks.at(5).cid, filePart2.cid)
  t.deepEqual(blocks.at(5).bytes, filePart2.bytes)
  t.deepEqual(blocks.at(6).cid, filePart3.cid)
  t.deepEqual(blocks.at(6).bytes, filePart3.bytes)
  t.deepEqual(blocks.at(7).cid, filePart4.cid)
  t.deepEqual(blocks.at(7).bytes, filePart4.bytes)
})

test('should getPath on large file with dagScope=entity, order=dfs', async t => {
  // return all blocks in path and all blocks for resolved target of path
  const filePart1 = await Block.decode({ codec: raw, bytes: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart2 = await Block.decode({ codec: raw, bytes: fromString(`EVEN MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart3 = await Block.decode({ codec: raw, bytes: fromString(`SO MUCH TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart4 = await Block.decode({ codec: raw, bytes: fromString(`TEST DATA DOING THE MOST ${Date.now()}`), hasher: sha256 })
  const fileSubNode1 = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart1.cid },
        { Name: '1', Hash: filePart2.cid }
      ]
    }
  })
  const fileSubNode2 = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart3.cid },
        { Name: '1', Hash: filePart4.cid }
      ]
    }
  })

  const fileNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: fileSubNode1.cid },
        { Name: '1', Hash: fileSubNode2.cid }
      ]
    }
  })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: fileNode.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([filePart1, filePart2, filePart3, filePart4, fileSubNode1, fileSubNode2, fileNode, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })

  const blocks = []
  const dagScope = 'entity'
  const order = 'dfs'
  for await (const entry of dagula.getPath(`${dirNode.cid}/foo`, { dagScope, order })) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 8)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
  t.deepEqual(blocks.at(2).cid, fileSubNode1.cid)
  t.deepEqual(blocks.at(2).bytes, fileSubNode1.bytes)
  t.deepEqual(blocks.at(3).cid, filePart1.cid)
  t.deepEqual(blocks.at(3).bytes, filePart1.bytes)
  t.deepEqual(blocks.at(4).cid, filePart2.cid)
  t.deepEqual(blocks.at(4).bytes, filePart2.bytes)
  t.deepEqual(blocks.at(5).cid, fileSubNode2.cid)
  t.deepEqual(blocks.at(5).bytes, fileSubNode2.bytes)
  t.deepEqual(blocks.at(6).cid, filePart3.cid)
  t.deepEqual(blocks.at(6).bytes, filePart3.bytes)
  t.deepEqual(blocks.at(7).cid, filePart4.cid)
  t.deepEqual(blocks.at(7).bytes, filePart4.bytes)
})

test('should getPath on file with dagScope=block', async t => {
  // return all blocks in path and all blocks for resolved target of path
  const filePart1 = await Block.decode({ codec: raw, bytes: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const filePart2 = await Block.decode({ codec: raw, bytes: fromString(`EVEN MORE TEST DATA ${Date.now()}`), hasher: sha256 })
  const fileNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'file' }).marshal(),
      Links: [
        { Name: '0', Hash: filePart1.cid },
        { Name: '1', Hash: filePart2.cid }
      ]
    }
  })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: fileNode.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([filePart1, filePart2, fileNode, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  const dagScope = 'block'
  for await (const entry of dagula.getPath(`${dirNode.cid}/foo`, { dagScope })) {
    blocks.push(entry)
  }
  // did not try and return block for `other`
  t.is(blocks.length, 2)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
  t.deepEqual(blocks.at(1).cid, fileNode.cid)
  t.deepEqual(blocks.at(1).bytes, fileNode.bytes)
})

test('should getPath on dir with dagScope=entity', async t => {
  // return all blocks in path. as it's a dir, it should stop there
  const file = await Block.decode({ codec: raw, bytes: fromString(`MORE TEST DATA ${Date.now()}`), hasher: sha256 })

  const dirNode = await Block.encode({
    codec: dagPB,
    hasher: sha256,
    value: {
      Data: new UnixFSv1({ type: 'directory' }).marshal(),
      Links: [
        { Name: 'foo', Hash: file.cid },
        { Name: 'other', Hash: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn') }
      ]
    }
  })

  const peer = await startBitswapPeer([file, dirNode])

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${dirNode.cid}`, { dagScope: 'entity' })) {
    blocks.push(entry)
  }
  // only return the dir if dagScope=entity and target is a dir
  t.is(blocks.length, 1)
  t.deepEqual(blocks.at(0).cid, dirNode.cid)
  t.deepEqual(blocks.at(0).bytes, dirNode.bytes)
})

test('should getPath to a hamt dir with dagScope=entity', async t => {
  const { readable, writable } = new TransformStream(undefined, UnixFS.withCapacity(1048576 * 32))
  const writer = writable.getWriter()

  const file = UnixFS.createFileWriter({ writer })
  file.write(new TextEncoder().encode('HELP'))
  const fileLink = await file.close()

  const dir = UnixFS.createShardedDirectoryWriter({ writer })
  dir.set('foo', fileLink)
  const dirLink = await dir.close()
  writer.close()

  const allBlocks = await collect(readable)
  const peer = await startBitswapPeer(allBlocks)

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const entry of dagula.getPath(`${dirLink.cid}`, { dagScope: 'entity' })) {
    blocks.push(entry)
  }

  // only return the dir if dagScope=entity and target is a dir
  t.is(blocks.length, 1)
  t.deepEqual(blocks.at(0).cid, dirLink.cid)
})

test('should getPath to a sharded hamt dir with dagScope=entity', async t => {
  const { readable, writable } = new TransformStream(undefined, UnixFS.withCapacity(1048576 * 32))
  const writer = writable.getWriter()

  const file = UnixFS.createFileWriter({ writer })
  file.write(new TextEncoder().encode('HELP'))
  const fileLink = await file.close()

  const dir = UnixFS.createShardedDirectoryWriter({ writer })
  // make a bunch of links to force some imtermediate hamt shards
  for (const x of Array.from(Array(250), (_, i) => i)) {
    dir.set(`empty-${x}`, {
      cid: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'),
      dagByteLength: 0
    })
  }
  dir.set('foo', fileLink)
  const dirLink = await dir.close()
  writer.close()

  const allBlocks = await collect(readable)
  const peer = await startBitswapPeer(allBlocks)

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const block of dagula.getPath(`${dirLink.cid}`, { dagScope: 'entity' })) {
    blocks.push(block)
  }

  // return only the dir if dagScope=entity and target is a dir. file block should be missing
  t.is(blocks.length, allBlocks.length - 1, 'all blocks for sharded dir were included')
  t.deepEqual(blocks[0].cid, dirLink.cid, 'first block is root of dir')
  t.false(blocks.some(b => b.cid.toString() === fileLink.cid.toString()), 'linked file was not returned because dagScope: entity')
})

test('should getPath through sharded hamt dir with dagScope=entity', async t => {
  const { readable, writable } = new TransformStream(undefined, UnixFS.withCapacity(1048576 * 32))
  const writer = writable.getWriter()

  const file = UnixFS.createFileWriter({ writer })
  file.write(new TextEncoder().encode('HELP'))
  const fileLink = await file.close()

  const dir = UnixFS.createShardedDirectoryWriter({ writer })
  // make a bunch of links to force some imtermediate hamt shards
  for (const x of Array.from(Array(1000), (_, i) => i)) {
    dir.set(`empty-${x}`, {
      cid: CID.parse('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'),
      dagByteLength: 0
    })
  }
  dir.set('foo', fileLink)
  const dirLink = await dir.close()
  writer.close()

  const allBlocks = await collect(readable)
  const peer = await startBitswapPeer(allBlocks)

  const libp2p = await getLibp2p()
  const dagula = await fromNetwork(libp2p, { peer: peer.libp2p.getMultiaddrs()[0] })
  const blocks = []
  for await (const block of dagula.getPath(`${dirLink.cid}/foo`, { dagScope: 'entity' })) {
    blocks.push(block)
  }

  // only return the hamt root, hamt shard, and file block
  t.is(blocks.length, 3)
  t.deepEqual(blocks.at(0).cid, dirLink.cid)
  t.deepEqual(blocks.at(2).cid, fileLink.cid)
})

test('should yield intermediate blocks when last path component does not exist', async t => {
  const { readable, writable } = new TransformStream()
  const blockstore = new MemoryBlockstore()
  const [fileLink] = await Promise.all([
    (async () => {
      const file = UnixFS.createFileWriter({ writer: writable.getWriter() })
      await file.write(new TextEncoder().encode('DATA'))
      return file.close({ closeWriter: true })
    })(),
    readable.pipeTo(new WritableStream({
      write: block => blockstore.put(block.cid, block.bytes)
    }))
  ])

  const dagula = new Dagula(blockstore)
  const blocks = []
  await t.throwsAsync(async () => {
    for await (const block of dagula.getPath(`${fileLink.cid}/foo`)) {
      blocks.push(block)
    }
  }, { message: 'file does not exist' })

  t.is(blocks.length, 1)
  t.is(blocks[0].cid.toString(), fileLink.cid.toString())
})
