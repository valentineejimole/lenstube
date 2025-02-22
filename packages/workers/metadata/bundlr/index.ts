import base64url from 'base64url'
import { bytesToHex, hexToBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  byteArrayToLong,
  longTo8ByteArray,
  serializeTags,
  shortTo2ByteArray,
  sign
} from './utils'

interface DataItemCreateOptions {
  target?: string
  anchor?: string
  tags?: {
    name: string
    value: string
  }[]
}

export class Secp256k1 {
  readonly ownerLength: number = 65
  readonly signatureLength: number = 65
  readonly signatureType = 3
  public readonly pk: string

  constructor(protected _key: string, pk: Buffer) {
    this.pk = pk.toString('hex')
  }
}

export class EthereumSigner extends Secp256k1 {
  get publicKey(): Buffer {
    return Buffer.from(this.pk, 'hex')
  }

  constructor(key: string) {
    const b = Buffer.from(key, 'hex')
    const account = privateKeyToAccount(bytesToHex(b))
    super(key, Buffer.from(hexToBytes(account.publicKey)))
  }

  sign(message: Uint8Array): Uint8Array {
    return privateKeyToAccount(`0x${this._key}`)
      .signMessage({ message: { raw: toHex(message) } })
      .then((r) => {
        return Buffer.from(r.slice(2), 'hex')
      }) as any
  }
}

export class DataItem {
  private readonly binary: Buffer
  private _id!: Buffer

  constructor(binary: Buffer) {
    this.binary = binary
  }

  get signatureType(): number {
    const signatureTypeVal: number = byteArrayToLong(this.binary.subarray(0, 2))
    return signatureTypeVal
  }

  get id(): string {
    return base64url.encode(this._id)
  }

  get rawOwner(): Buffer {
    return this.binary.subarray(
      2 + this.signatureLength,
      2 + this.signatureLength + this.ownerLength
    )
  }

  get signatureLength(): number {
    return 65
  }

  get ownerLength(): number {
    return 65
  }

  get rawTarget(): Buffer {
    const targetStart = this.getTargetStart()
    const isPresent = this.binary[targetStart] === 1
    return isPresent
      ? this.binary.subarray(targetStart + 1, targetStart + 33)
      : Buffer.alloc(0)
  }

  get rawAnchor(): Buffer {
    const anchorStart = this.getAnchorStart()
    const isPresent = this.binary[anchorStart] === 1

    return isPresent
      ? this.binary.subarray(anchorStart + 1, anchorStart + 33)
      : Buffer.alloc(0)
  }

  get rawTags(): Buffer {
    const tagsStart = this.getTagsStart()
    const tagsSize = byteArrayToLong(
      this.binary.subarray(tagsStart + 8, tagsStart + 16)
    )

    return this.binary.subarray(tagsStart + 16, tagsStart + 16 + tagsSize)
  }

  get rawData(): Buffer {
    const tagsStart = this.getTagsStart()
    const numberOfTagBytesArray = this.binary.subarray(
      tagsStart + 8,
      tagsStart + 16
    )
    const numberOfTagBytes = byteArrayToLong(numberOfTagBytesArray)
    const dataStart = tagsStart + 16 + numberOfTagBytes

    return this.binary.subarray(dataStart, this.binary.length)
  }

  getRaw(): Buffer {
    return this.binary
  }

  public async sign(signer: EthereumSigner): Promise<Buffer> {
    this._id = await sign(this, signer)
    return this._id
  }

  private getTagsStart(): number {
    const targetStart = this.getTargetStart()
    const targetPresent = this.binary[targetStart] === 1
    let tagsStart = targetStart + (targetPresent ? 33 : 1)
    const anchorPresent = this.binary[tagsStart] === 1
    tagsStart += anchorPresent ? 33 : 1

    return tagsStart
  }

  private getTargetStart(): number {
    return 2 + this.signatureLength + this.ownerLength
  }

  private getAnchorStart(): number {
    let anchorStart = this.getTargetStart() + 1
    const targetPresent = this.binary[this.getTargetStart()] === 1
    anchorStart += targetPresent ? 32 : 0

    return anchorStart
  }
}

export const createData = (
  data: string | Uint8Array,
  signer: EthereumSigner,
  opts?: DataItemCreateOptions
): DataItem => {
  const _owner = signer.publicKey
  const _target = opts?.target ? base64url.toBuffer(opts.target) : null
  const target_length = 1 + (_target?.byteLength ?? 0)
  const _anchor = opts?.anchor ? Buffer.from(opts.anchor) : null
  const anchor_length = 1 + (_anchor?.byteLength ?? 0)
  const _tags = (opts?.tags?.length ?? 0) > 0 ? serializeTags(opts?.tags) : null
  const tags_length = 16 + (_tags ? _tags.byteLength : 0)
  const _data = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
  const data_length = _data.byteLength

  const length =
    2 +
    signer.signatureLength +
    signer.ownerLength +
    target_length +
    anchor_length +
    tags_length +
    data_length
  const bytes = Buffer.alloc(length)

  bytes.set(shortTo2ByteArray(signer.signatureType), 0)
  bytes.set(new Uint8Array(signer.signatureLength).fill(0), 2)

  if (_owner.byteLength !== signer.ownerLength) {
    throw new Error(
      `Owner must be ${signer.ownerLength} bytes, but was incorrectly ${_owner.byteLength}`
    )
  }
  bytes.set(_owner, 2 + signer.signatureLength)

  const position = 2 + signer.signatureLength + signer.ownerLength
  bytes[position] = _target ? 1 : 0
  if (_target) {
    if (_target.byteLength !== 32) {
      throw new Error(
        `Target must be 32 bytes but was incorrectly ${_target.byteLength}`
      )
    }
    bytes.set(_target, position + 1)
  }

  const anchor_start = position + target_length
  let tags_start = anchor_start + 1
  bytes[anchor_start] = _anchor ? 1 : 0
  if (_anchor) {
    tags_start += _anchor.byteLength
    if (_anchor.byteLength !== 32) {
      throw new Error('Anchor must be 32 bytes')
    }
    bytes.set(_anchor, anchor_start + 1)
  }

  bytes.set(longTo8ByteArray(opts?.tags?.length ?? 0), tags_start)
  const bytesCount = longTo8ByteArray(_tags?.byteLength ?? 0)
  bytes.set(bytesCount, tags_start + 8)
  if (_tags) {
    bytes.set(_tags, tags_start + 16)
  }

  const data_start = tags_start + tags_length
  bytes.set(_data, data_start)

  return new DataItem(bytes)
}
