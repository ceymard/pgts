import * as s from "@salesway/scotty"

const re_number = /^[-+]?\d+(\.\d+)?$/

function pad(x: number) { return x < 10 ? `0${x}` : x }
function to_local_datetime(d: Date) {
	return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`
}

function serialize_tz(r: PgRange<any>): unknown {
	let start = typeof r.start === "object" ? '"' + (r.start as Date).toJSON() + '"' : r.start
	let end = typeof r.end === "object" ? '"' + (r.end as Date).toJSON() + '"' : r.end
	return `${r.bounds[0]}${start},${end}${r.bounds[1]}`
}

function serialize_local(r: PgRange<any>): unknown {
	let start = typeof r.start === "object" ? '"' + to_local_datetime(r.start as Date) + '"' : r.start
	let end = typeof r.end === "object" ? '"' + to_local_datetime(r.end as Date) + '"' : r.end
	return `${r.bounds[0]}${start},${end}${r.bounds[1]}`
}

function deserialize_to_local(r: any): PgRange<any> {
	if (typeof r === "string") {
		const bounds = `${r[0]}${r[r.length - 1]}`
		const exp = r.slice(1, -1)
		const [_start, _end] = exp.split(/,/)
		const start = _start ? (_start[0] === '"' ? new Date(_start.slice(1, -1)) : JSON.parse(_start)) : -Infinity
		const end = _end ? (_end[0] === '"' ? new Date(_end.slice(1, -1)) : JSON.parse(_end)) : Infinity

		return new PgRange(start, end, bounds)
	} else if (typeof r === "object") {
		// Object ?
		return new PgRange(r.start, r.end, r.bounds)
	}
	throw new Error("could not deserialize")
}

export const range = new s.PropAction(
	serialize_local,
	deserialize_to_local,
).decorator

export const tzrange = new s.PropAction(
	serialize_tz,
	deserialize_to_local,
)

export class PgRange<T extends {valueOf(): number}> {

	get lower_is_inclusive() {
		return this.bounds[0] === "["
	}

	get upper_is_inclusive() {
		return this.bounds[1] === "]"
	}

	constructor(
		public start: T,
		public end: T,
		public bounds = "[]",
	) {
		if ((bounds[0] !== "[" && bounds[0] !== "(") || (bounds[1] !== "]" && bounds[1] !== ")")) {
			throw new Error("wrong bounds description")
		}
	}

	includes(num: T | PgRange<any>): boolean {
		if (num instanceof PgRange) {
			// FIXME: missing checking non-inclusive boundaries that happen to overlap
			return this.includes(num.start) && this.includes(num.end)
		}
		let _lower_check = this.lower_is_inclusive ? 
			  num.valueOf() >= this.start.valueOf() 
			: num.valueOf() > this.start.valueOf()
		let _upper_check = this.upper_is_inclusive ? 
			  num.valueOf() <= this.end.valueOf()
			: num.valueOf() < this.end.valueOf()
		return _lower_check && _upper_check
	}

	overlaps(range: PgRange<T>) {
		return this.includes(range.start) || this.includes(range.end)
	}

	clamp(num: T): T
	clamp(num: PgRange<T>): PgRange<T>
	clamp(num: T | PgRange<T>): T | PgRange<T> {
		if (num instanceof PgRange) {
			throw new Error("not implemented")
		}
		return num.valueOf() < this.start.valueOf() ? this.start
			: num.valueOf() > this.end.valueOf() ? this.end
			: num
	}

	get isFinite() {
		return Number.isFinite(this.start.valueOf()) && Number.isFinite(this.end.valueOf())
	}

	toJSON() {
		return serialize_local(this)
	}

	isAfterOrIncludes() {

	}

	isBeforeOrIncludes() {

	}

	isStrictlyAfter() {

	}

	isStrictlyBefore() {

	}
}
