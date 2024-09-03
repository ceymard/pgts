import * as s from "@salesway/scotty"

const re_number = /^[-+]?\d+(\.\d+)?$/

function pad(x: number) { return x < 10 ? `0${x}` : x }
function to_local_datetime(d: Date) {
	return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`
}

function serialize_tz(r: PgRange<any>): unknown {
	let start = typeof r.start === "object" ? '"' + (r.start.value as Date).toJSON() + '"' : r.start
	let end = typeof r.end === "object" ? '"' + (r.end.value as Date).toJSON() + '"' : r.end
	return `${r.start.inclusion}${start},${end}${r.end.inclusion}`
}

function serialize_local(r: PgRange<any>): unknown {
	let start = typeof r.start === "object" ? '"' + to_local_datetime(r.start as Date) + '"' : r.start
	let end = typeof r.end === "object" ? '"' + to_local_datetime(r.end as Date) + '"' : r.end
	return `${r.start.inclusion}${start},${end}${r.end.inclusion}`
}

function deserialize_to_local(r: any): PgRange<any> {
	if (typeof r === "string") {
		if (r === "empty") {
			return PgRange.EMPTY
		}

		// const bounds = `${r[0]}${r[r.length - 1]}`
		const exp = r.slice(1, -1)
		const [_start, _end] = exp.split(/,/)
		const start = _start ? (_start[0] === '"' ? new Date(_start.slice(1, -1)) : JSON.parse(_start)) : -Infinity
		const end = _end ? (_end[0] === '"' ? new Date(_end.slice(1, -1)) : JSON.parse(_end)) : Infinity

		return new PgRange(
			start,
			end,
			r
		)
	} else if (typeof r === "object") {
		// Object ?
		return new PgRange(r.start, r.end)
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

	static EMPTY = new PgRange(Infinity, -Infinity)

	get is_empty() {
		const start = this.start.valueOf()
		const end = this.end.valueOf()
		return end < start || start === end && this.bounds === "()"
	}

	constructor(
		public start: T,
		public end: T,
		public bounds = "()",
	) {

	}

	contains(num: T | PgRange<T>): boolean {

		const start = this.start.valueOf()
		const end = this.end.valueOf()

		if (num instanceof PgRange) {

			if (this.is_empty || num.is_empty) {
				return false
			}

			const ostart = num.start.valueOf()
			const oend = num.end.valueOf()

			if (ostart < start || oend > end) {
				return false
			}

			return true
		}

		const nm = num.valueOf()
		return nm === start && (this.bounds[0] === "[" || start === -Infinity)
		  || nm === end && (this.bounds[1] === "]" || end === Infinity)
			|| nm > start && nm < end
	}

	overlaps(range: T | PgRange<T>) {


		if (!(range instanceof PgRange)) {
			return this.contains(range)
		}

		if (this.is_empty || range.is_empty) {
			return false
		}

		return this.contains(range.start) || this.contains(range)
			|| range.contains(this.start) || range.contains(this.end)
	}

	/** merge with another range and returns a range that contains both */
	extend(range: PgRange<T>) {
		if (range.is_empty) {
			return this
		}

		if (this.is_empty) {
			return range
		}

		const rng = new PgRange(this.start, this.end, this.bounds)

		if (range.start < this.start) {
			rng.start = range.start
			rng.bounds = range.bounds[0] + rng.bounds[1]
		}

		if (range.start === this.start) {
			rng.bounds = range.bounds[0] === "[" || this.bounds[0] === "[" ? "[" : "("
		}

		if (range.end > this.end) {
			rng.end = range.end
			rng.bounds = rng.bounds[0] + range.bounds[1]
		}

		if (range.end === this.end) {
			rng.bounds = range.bounds[1] === "]" || this.bounds[0] === "]" ? "]" : ")"
		}

		return rng
	}

	clamp(num: T): T
	clamp(num: PgRange<T>): PgRange<T>
	clamp(num: T | PgRange<T>): T | PgRange<T> {

		if (num instanceof PgRange) {

			const rng = new PgRange(num.start, num.end, num.bounds)
			if (this.start > num.start) {
				rng.start = this.start
				rng.bounds = this.bounds[0] + rng.bounds[1]
			}

			if (this.end < num.end) {
				rng.end = this.end
				rng.bounds = rng.bounds[0] + this.bounds[1]
			}

			if (num.start === this.start) {
				rng.bounds = num.bounds[0] === "[" && this.bounds[0] === "[" ? "[" : "("
			}

			if (num.end === this.end) {
				rng.bounds = num.bounds[1] === "]" && this.bounds[0] === "]" ? "]" : ")"
			}

			return rng
		}

		return (num.valueOf() < this.start.valueOf() ? this.start
			: num.valueOf() > this.end.valueOf() ? this.end
			: num) as T
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
