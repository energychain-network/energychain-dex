// Minimal, dependency-free protobuf3 encoder for the EnergyChain native Msg
// types. CosmJS's SigningStargateClient handles the Tx/AuthInfo/SignDoc
// envelopes; it only needs each custom message registered as a GeneratedType
// whose `encode(value).finish()` returns canonical proto3 bytes. Because every
// field on these messages is a scalar (string / uint64 / uint32 / int64 /
// bool / enum), a tiny writer is sufficient and avoids pulling generated code
// or a proto runtime into the bundle.
//
// proto3 semantics implemented: default values (0 / "" / false) are omitted
// from the wire, matching what the chain produces, so the bytes we sign match
// the bytes the node verifies.

export type FieldType = 'string' | 'uint64' | 'uint32' | 'int64' | 'bool' | 'enum';

export interface FieldSpec {
  no: number;
  name: string;
  type: FieldType;
}

class Writer {
  private buf: number[] = [];

  private byte(b: number) {
    this.buf.push(b & 0xff);
  }

  private varint(value: bigint) {
    let v = value;
    if (v < 0n) v += 1n << 64n; // two's complement for negative int64
    while (v > 0x7fn) {
      this.byte(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    this.byte(Number(v));
  }

  tag(fieldNo: number, wireType: number) {
    this.varint(BigInt((fieldNo << 3) | wireType));
  }

  uint(fieldNo: number, value: bigint) {
    this.tag(fieldNo, 0);
    this.varint(value);
  }

  bool(fieldNo: number, value: boolean) {
    this.tag(fieldNo, 0);
    this.varint(value ? 1n : 0n);
  }

  string(fieldNo: number, value: string) {
    const bytes = new TextEncoder().encode(value);
    this.tag(fieldNo, 2);
    this.varint(BigInt(bytes.length));
    for (const b of bytes) this.byte(b);
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

function toBig(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v.trim() !== '') return BigInt(v);
  return 0n;
}

// makeType builds a CosmJS GeneratedType-compatible codec from a field spec.
export function makeType(fields: FieldSpec[]) {
  return {
    // CosmJS calls encode(value).finish().
    encode(message: Record<string, unknown>) {
      const w = new Writer();
      for (const f of fields) {
        const v = message?.[f.name];
        switch (f.type) {
          case 'string': {
            const s = (v as string) ?? '';
            if (s !== '') w.string(f.no, s);
            break;
          }
          case 'bool': {
            if (v === true) w.bool(f.no, true);
            break;
          }
          case 'uint64':
          case 'uint32':
          case 'int64':
          case 'enum': {
            const n = toBig(v);
            if (n !== 0n) w.uint(f.no, n);
            break;
          }
        }
      }
      return w;
    },
    // Decode is only used by Registry.decode (not on the signing path). We keep
    // a permissive stub so registration succeeds.
    decode(_input: Uint8Array): Record<string, unknown> {
      return {};
    },
    fromPartial(p: Record<string, unknown>): Record<string, unknown> {
      return { ...p };
    },
  };
}
