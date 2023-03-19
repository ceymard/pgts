import { ISerializable } from "cerialize"

declare module "cerialize" {
  function GenericDeserialize<T>(json: any[], type: INewable<T>): T[];
}

export class Serializer<T = any> implements ISerializable {
  property: string | symbol = null!
  no_deser = false
  no_ser = false

  constructor(
    public Serialize: (v: T | null) => any,
    public Deserialize: (v: string | null) => T | null
  ) {
    this.Serialize = (v: any) => v == null ? v : Array.isArray(v) ? v.map(v => Serialize(v)) : Serialize(v)
    this.Deserialize = (v: any) => v == null ? v : Array.isArray(v) ? v.map(v => Deserialize(v)) : Deserialize(v)
  }

  prop(name: string | symbol) {
    const s = new Serializer(this.Serialize, this.Deserialize)
    s.property = name
    return s
  }
}

const S = Serializer

export const str = new S<string>(
  s => String(s),
  s => String(s)
)


export const num = new S<number>(
  n => Number(n),
  n => Number(n)
)


export const bool = new S<boolean>(
  b => !!b,
  b => !!b
)

export const json = new S<any>(
  j => j,
  j => j,
)


export const hstore = {
  Serialize: (h: Map<string, string>) => h == null ? h : [...h.entries()]
    .map(([key, value]) =>
      `"${key.replace(/"/g, '""')}"=>"${value.replace(/"/g, '""')}"`
    ),
  Deserialize: function deserialize_hstore(h: {[name: string]: string}) {
    if (h == null) return null
    return new Map(Object.entries(h))
  }
}

function _pad(v: number) { return v < 10 ? "0" + v : "" + v }

/** A date serializer */
export const date = new S<Date>(
  function date_to_json_with_tz(d) {
    if (d == null) return null
    const tz_offset = d.getTimezoneOffset()
    const tz_sign = tz_offset > 0 ? '-' : '+'
    const tz_hours = _pad(Math.abs(Math.floor(tz_offset / 60)))
    const tz_minutes = _pad(Math.abs(tz_offset) % 60)
    const tz_string = `${tz_sign}${tz_hours}:${tz_minutes}`
    const dt = `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`

    return `${dt}${tz_string}`
  },
  d => d == null ? d : new Date(d)
)
