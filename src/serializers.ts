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

  }

  prop(name: string | symbol) {
    const s = new Serializer(this.Serialize, this.Deserialize)
    s.property = name
    return s
  }
}

const S = Serializer

export function arr(target: any, key: string) {

}

export const str = new S<string>(
  s => s == null ? s : String(s),
  s => s == null ? s : String(s)
)


export const num = new S<number>(
  n => n == null ? n : Number(n),
  n => n == null ? n : Number(n)
)


export const bool = new S<boolean>(
  b => b == null ? b : !!b,
  b => b == null ? b : !!b
)

export const json = new S<any>(
  j => j,
  j => j,
)


export const hstore = new S<Map<string, string>>(
  h => h == null ? h : [...h.entries()]
    .map(([key, value]) =>
      `"${key.replace(/"/g, '""')}"=>"${value.replace(/"/g, '""')}"`
    ),
  function deserialize_hstore(h) {
    if (h == null) return null
    const res = new Map<string, string>()
    let in_quote = false
    let key = ""
    let start = 0
    for (let i = 0, l = h.length; i <= l; i++) {
      const ch = h[i]
      if (in_quote && ch !== '"') continue

      switch (ch) {
        case "\"": {
          if (!in_quote) {
            in_quote = true
            continue
          } else {
            if (h[i+1] === "\"") {
              i++
              continue
            } else {
              in_quote = false
            }
          }
          continue
        }
        case "=": {
          if (h[i+1] === ">") {
            key = "" + h.slice(start, i)
            start = i + 2
          }
          continue
        }
        case undefined:
        case ",": {
          let value = "" + h.slice(start, i)
          start = i + 1
          if (value[0] === '"') value = value.slice(1, -1)
          if (key[0] === '"') key = key.slice(1, -1)
          res.set(key, value)
          continue
        }
      }
    }

    return res
  }
)


/** A date serializer */
export const date = new S<Date>(
  function date_to_json_with_tz(date) {
    if (date == null) return null
    const tz_offset = date.getTimezoneOffset()
    const tz_sign = tz_offset > 0 ? '-' : '+'
    const tz_hours = Math.abs(Math.floor(tz_offset / 60)).toString().padStart(2, '0')
    const tz_minutes = (Math.abs(tz_offset) % 60).toString().padStart(2, '0')
    const tz_string = `${tz_sign}${tz_hours}:${tz_minutes}`

    const date_string = date.toISOString().replace('Z', tz_string)

    return date_string
  },
  d => d == null ? d : new Date(d)
)
