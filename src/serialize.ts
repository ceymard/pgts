import * as util from "util"

export const sym_serializer = Symbol("serializer")

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonObject
  | JsonValue[]

export type JsonObject = {[name: string]: JsonValue}

declare global {
  interface Function {
    [sym_serializer]?: Serializer
  }
}

interface Ctor<T = unknown> {
  new(): T;
  [sym_serializer]: Serializer<T>;
}


export class Action<T = unknown> {

  get internal_key(): symbol | string | null { return null }

  /** Clone shallow copies the Action */
  clone(): this {
    let _this = this
    // clone() can be called from the context of a decorator function, so we unbox it here to make sure we do have the Action.
    if (typeof _this === "function") _this = Object.getPrototypeOf(this)
    const clone = Object.create(
      Object.getPrototypeOf(_this),
      Object.getOwnPropertyDescriptors(_this)
    )
    return clone
  }

  get decorator(): ((target: any, prop?: string) => void) & this {
    const res = (target: any, prop?: string | symbol) => {
      this.decorate(target, prop)
    }
    // clone() has to take care of undoing this first
    Object.setPrototypeOf(res, this)
    return res as any // Yeah, we cheat
  }

  deserialize(instance: T, json: JsonObject) { }
  serialize(instance: T, json: JsonObject) { }

  decorate(target: any, prop?: string | symbol) {
    // when decorating a class, we get its prototype, so we need to check
    // its constructor
    const ser = Serializer.get(target, true)
    ser.addAction(this)
  }
}

export type OnDeserializedFn<T> = (instance: T, json: JsonObject) => unknown

export class ActionOnDeserialize<T> extends Action<T> {
  constructor(public _on_deserialize: OnDeserializedFn<T>) {
    super()
  }

  deserialize(instance: T, json: JsonObject): void {
    this._on_deserialize(instance, json)
  }
}

export function on_deserialize<T>(fn: OnDeserializedFn<T>) {
  return new ActionOnDeserialize(fn).decorator
}

export type PropSerializerFn<F = unknown, T = unknown> = (v: F, result: JsonObject, instance: T) => unknown
export type PropDeserializerFn<F = unknown, T = unknown> = (value: JsonValue, instance: T, source_object: JsonObject) => F


export class PropAction<F = unknown, T = unknown> extends Action<T> {
  prop: string | symbol = ""
  serializeTo: string | null = null
  deserializeFrom: string | null = null
  private _ignore_null = false

  constructor(
    public serializer?: PropSerializerFn<F, T>,
    public deserializer?: PropDeserializerFn<F, T>,
  ) {
    super()
  }

  get internal_key() { return this.prop }

  property(key: string | symbol) {
    const clone = this.clone()
    clone.prop = key
    if (typeof key === "string") {
      if (!clone.serializeTo) clone.serializeTo = key
      if (!clone.deserializeFrom) clone.deserializeFrom = key
    }
    return clone
  }

  to(key: string | null) {
    const clone = this.clone()
    clone.serializeTo = key
    return clone.decorator
  }

  from(key: string | null) {
    const clone = this.clone()
    clone.deserializeFrom = key
    return clone.decorator
  }

  deserialize(instance: T, source: JsonObject) {
    if (this.deserializer == null) return

    let oval = (source as any)?.[this.deserializeFrom ?? this.prop]
    if (oval == null) {
      const curval = (instance as any)?.[this.prop]
      // There was no value in the original object
      if (curval == null && !this._ignore_null) {
        (instance as any)[this.prop] = null
      }
    } else {
      // There was a value, we're now going to deserialize it
      (instance as any)[this.prop] = this.deserializer(oval, instance, source)
    }
  }

  serialize(instance: T, json: JsonObject) {
    if (this.serializer == null) return

    let oval = (instance as any)?.[this.prop]
    if (oval == null) {
      (json as any)[this.serializeTo ?? this.prop] = null
    } else {
      (json as any)[this.serializeTo ?? this.prop] = this.serializer(oval, json, instance)
    }
  }

  /** This method is invoked by the proxies */
  addTo(c: Ctor<T>, key: string | symbol) {
    const clone = this.property(key)
    const ser = Serializer.get(c, true)
    ser.addAction(clone)
  }

  /** */
  decorate(target: any, prop: string | symbol): void {
    this.addTo(target.constructor, prop)
  }

}


/**
 *
 */
export class Serializer<T extends unknown = unknown> {

  constructor(public model: {new(): T}) {

  }

  static get<T>(ctor: Function | {new(): T}, create = false): Serializer<T> {

    if (!ctor.hasOwnProperty(sym_serializer)) {
      if (!create) throw new Error("there is no known serializer for this object")
      const res = new Serializer<T>(ctor as {new(): T})

      // Check if there was a parent to this class
      const parent: Object = Object.getPrototypeOf(ctor)
      if (parent.hasOwnProperty(sym_serializer)) {
        const parent_ser: Serializer = (parent as any)[sym_serializer]
        if (parent_ser != null) {
          for (let a of parent_ser.actions) {
            res.addAction(a)
          }
        }
      }

      ;(ctor as Ctor)[sym_serializer] = res
      return res
    }
    return (ctor as Ctor)[sym_serializer] as Serializer<T>
  }

  static getFor<T>(obj: T | {new(...a: any[]): T | T[]}) {

  }

  /** since actions have internal keys, the Map is used to override actions */
  action_map = new Map<string | symbol, number>()
  /** the array is maintained separately */
  actions: Action[] = []

  addAction(action: Action) {
    const intkey = action.internal_key
    if (intkey != null) {
      let idx = this.action_map.get(intkey)
      if (idx) {
        this.actions[idx] = action
      } else {
        idx = this.actions.length
        this.actions.push(action)
        this.action_map.set(intkey, idx)
      }
    } else {
      this.actions.push(action)
    }
  }

  // is it needed ??
  removeAction(key: string | symbol) {

  }

  serialize(orig: T, res: JsonObject = {}): JsonObject {
    for (let i = 0, ac = this.actions, l = ac.length; i < l; i++) {
      ac[i].serialize(orig, res)
    }
    return res
  }

  deserialize(orig: JsonObject, into: T = new this.model()): T {
    for (let i = 0, ac = this.actions, l = ac.length; i < l; i++) {
      ac[i].deserialize(into, orig)
    }
    return into!
  }

}


/////////////////////////////////////////////////////////////////////////////////////////////


/**
 * Deserialize a value coming from another source into either a brand new object if a constructor (or class object) is given, or an existing object if it is provided.
 *
 * `json` and `kls` must have the same length if they are both arrays.
 *
 * @param json Json value that comes from an external source
 * @param kls The class on which we have defined a serializer or an instance in which to deserialize the contents of the json object.
 */
export function deserialize<T>(json: unknown[], kls: {new(): T} | T[]): T[]
export function deserialize<T>(json: unknown, kls: T): T
export function deserialize<T>(json: unknown, kls: T | {new() : T}): T | T[] {
  if (Array.isArray(json)) {
    if (Array.isArray(kls)) {
      // kls are a bunch of instances
      if (kls.length !== json.length) throw new Error(`both arrays need to be the same length`)
      for (let i = 0, l = kls.length; i < l; i++) {
        // For every member of both arrays, get the serializer for the given destination item and deserialize in place.
        const ser = Serializer.get(kls[i])
        ser.deserialize(json[i] as JsonObject, kls[i])
      }
      return kls
    } else {
      const ser = Serializer.get(kls as Function)
      const res = new Array(json.length)
      for (let i = 0, l = res.length; i < l; i++) {
        res[i] = ser.deserialize(json[i] as JsonObject)
      }
      return res as T[]
    }
  }

  const ser = Serializer.get<T>(kls as Function)
  return ser.deserialize(json as JsonObject)
}


/**
 * Serialize
 * @param instance the object to serialize
 * @returns null if the object was null, a json object or a json array
 */
export function serialize<T extends any[]>(instance: T): unknown[]
export function serialize<T>(instance: T): unknown
export function serialize<T>(instance: T): unknown {
  if (instance == null) return null
  if (Array.isArray(instance)) {
    if (instance.length === 0) return[]
    const res = new Array(instance.length)
    for (let i = 0, l = res.length; i < l; i++) {
      const ser = Serializer.get(instance[0].constructor)
      res[i] = ser.serialize(instance[i])
    }
    return res
  } else {
    const ser = Serializer.get(instance.constructor)
    return ser.serialize(instance)
  }
}


////////////////////////////////////////////////////////////////////////////////////////////
////// Basic Actions

function make_prop_serializer<F = unknown, T = unknown>(
  ser: PropSerializerFn<F, T>,
  deser: PropDeserializerFn<F, T>,
) {
  return new PropAction<F, T>(ser, deser).decorator
}

export const str = make_prop_serializer<string>(function ser_str(s) { return String(s) }, function deser_str(s) { return String(s) })
export const num = make_prop_serializer<number>(function ser_num(n) { return Number(n) }, function deser_num(n) { return Number(n) })
export const bool = make_prop_serializer<boolean>(function ser_bool(b) { return !!b }, function deser_bool(b) { return !!b })
export const as_is = make_prop_serializer<JsonValue>(function ser_as_is(j) { return j }, function deser_as_is(j) { return j })

function _pad(v: number) { return v < 10 ? "0" + v : "" + v }

/**
 * A serializer for date that returns an ISO date understood by most databases, but with its local timezone offset instead of UTC like toJSON() returns.
 */
export const date_tz = make_prop_serializer<Date>(
  function date_with_tz_to_json(d) {
    if (d == null) return null
    const tz_offset = d.getTimezoneOffset()
    const tz_sign = tz_offset > 0 ? '-' : '+'
    const tz_hours = _pad(Math.abs(Math.floor(tz_offset / 60)))
    const tz_minutes = _pad(Math.abs(tz_offset) % 60)
    const tz_string = `${tz_sign}${tz_hours}:${tz_minutes}`
    const dt = `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`

    return `${dt}${tz_string}`
  },
  function date_with_tz_from_json(d) { return new Date(d as any) }
)

export const date_utc = make_prop_serializer<Date>(
  function date_to_utc(d) { return d.toJSON() },
  function date_from_utc(d) { return new Date(d as any) }
)

export const date_ms = make_prop_serializer<Date>(
  function date_to_ms(d) { return d.valueOf() },
  function date_from_ms(d) { return new Date(d as any) }
)

export const date_seconds = make_prop_serializer<Date>(
  function date_to_seconds(d) { return d.valueOf() / 1000 },
  function date_from_seconds(d) { return new Date(d as number * 1000) }
)

export const alias = function (fn: () => {new(...a:any[]): any}) {
  return make_prop_serializer(
    o => serialize<unknown>(o),
    o => deserialize(o, fn()),
  )
}

@on_deserialize(function do_stuff_with(inst) {
  console.log("just deserialized !", inst)
})
class Test {
  @str property: string = "zboub"
  @num numprop: number = 0
}

class Test2 extends Test {
  @bool.to("bool2") boolprop: boolean = false
}

class Test3 extends Test2 {
  @date_tz dt: Date = new Date()
}

class Zboubi {
  @alias(() => Test3) test: Test3 = new Test3()
}

// const ser = Test3[sym_serializer]
const des = deserialize([{dt: "2021-04-01"}], Test3)
console.log(des)
const t = new Test3()
console.log(serialize(t))
console.log(serialize([t]))

console.log(serialize(new Zboubi))