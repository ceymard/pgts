#!/usr/bin/env node

import { inspect } from "util"
import { CompositeTypeAttribute, extractSchemas, Schema, TableColumn, ViewColumn } from "extract-pg-schema"
import { array, boolean, command, flag, multioption, option, optional, positional, run, string } from "cmd-ts"
import { writeFileSync } from "fs"
import { version } from "../package.json"
import { ImplBlocks } from "./blocks"
import { js_beautify } from "js-beautify"


type SingleRenderable = number | string | null | undefined | false | SingleRenderable[] | Iterable<SingleRenderable>
// type Renderable = SingleRenderable | SingleRenderable[]

interface EnumerateOptions {
  quote?: boolean
}

declare global {

  interface Array<T> {
    enumerate(key: (keyof T) | ((v: T) => string), opts?: EnumerateOptions): Iterable<string>
  }
  interface Iterator<T> {
    enumerate(key: (keyof T) | ((v: T) => string), opts?: EnumerateOptions): Iterable<string>
  }
}

Array.prototype.enumerate = Iterator.prototype.enumerate = function enumerate<T>(key: (keyof T) | ((v: T) => string), opts: EnumerateOptions = {}): Iterable<string> {
  let ex = typeof key === "string" ? ((e: T) => e[key]) : key as ((v: T) => string)

  return this.map(elt => {
    let res = (ex(elt)?.toString() ?? "null")
    if (opts.quote) res = `"${res}"`
    return res
  })
}

function match<Args extends [RegExp, any][]>(...lst: Args) {
  const lst2 = lst.map(([reg, val]) => [new RegExp("^" + reg.source + "$", reg.flags), val])
  return function (elt: string): {[K in keyof Args]: Args[1]}[number] | undefined {
    for (const [reg, res] of lst2) {
      if (reg.test(elt)) {
        return res
      }
    }
  }
}


/** A function to build our output */
function build(arr: TemplateStringsArray, ...values: SingleRenderable[]) {
  const b: string[] = []

  function _add(s: SingleRenderable, b: string[]) {
    if (s == null || s === false) return

    if (typeof s === "string" || typeof s === "number") {
      b.push(s.toString().replace(/(\n *)/g, m => m + indent))
      return
    }

    if (Array.isArray(s) || typeof s[Symbol.iterator] === "function" || typeof (s as any).next === "function") {
      for (let v of s) {
        _add(v, b)
        b.push("\n" + indent)
      }
    } else {
      b.push(s.toString())
    }
  }

  let indent = ""
  const re_indent = /\n( *)$/
  for (let i = 0, l = arr.length; i < l; i++) {
    indent = re_indent.exec(arr[i])?.[1] ?? indent
    b.push(arr[i])

    const _b: string[] = []
    _add(values[i], _b)
    b.push(_b.join(""))
    // const lines = _b.join("").split(/\n/g)
    // let minindent = Math.min(...lines.slice(1).map(line => (line.match(/^( *)/)?.[1].length ?? 0)))
    // if (!Number.isFinite(minindent)) minindent = 0

    // const repl = new RegExp("^" + " ".repeat(minindent))
    // b.push(lines.map(l => l.replace(repl, indent)).join("\n"))
  }

  return b.join("")
}

function log<T>(a: T): T {
  console.log(inspect(a, false, null, true))
  return a
}

function CamelCase(s: string) {
  return s.replace(/(?:^|_)(.)/g, (_, m: string) => m.toUpperCase())
}

abstract class SchemaBase {

  constructor(public schemas: Record<string, Schema>, public allowed_schemas_str: string[]) {
    writeFileSync("./output.json", JSON.stringify(schemas, null, 2))
  }

}

type ValueType<M> = M extends Map<any, infer V> ? V : never


interface Reference {
  // other_table: string //ValueType<SchemaDetails["relations"]>
  distantName: string
  toTableObject: ValueType<SchemaDetails["relations"]>
  toTable: string
  toTableSimpleName: string
  pgtsName: string
  fromColumnsStr: string
  toColumnsStr: string
  toColumns: string[]
  fromColumns: string[]
  toIsUnique: boolean
  fromIsUnique: boolean
}


class SchemaDetails extends SchemaBase {

  allowed_schemas = new Set(this.allowed_schemas_str)

  getJsType(type: string) {
    const is_array = type.match(/\[\]/)
    type = type.replace(/[^.]+\.|\[\]/g, "")
    return (match(
      [/text|name/, "string"],
      [/bool/, "boolean"],
      [/(big)?int\d*?|numeric|float\d*?/, "number"],
      [/timestamp(tz)?|date/, "Date"],
      [/^jsonb?$/, "any"],
    )(type) ?? CamelCase(type)) + (is_array ? "[]" : "")
  }

  getJsParser(type: string) {
    const is_array = type.match(/\[\]/)
    type = type.replace(/[^.]+\.|\[\]/g, "")
    return (match(
      [/text|name/, "s.str"],
      [/bool/, "s.bool"],
      [/int\d*?|numeric|float\d*?/, "s.num"],
      [/timestamp(tz)?|date/, "s.date"],
      [/^jsonb?$/, "s.as_is"],
    )(type) ?? `s.embed(() => ${CamelCase(type)})`) + (is_array ? ".array" : "")
  }

  getReturnType(fn: Schema["functions"][number]) {
    const _arr = (fn.returnsSet ? "[]" : "")
    if (typeof fn.returnType === "string") {
      return this.getJsType(fn.returnType) + _arr
    }

    return "{" + fn.returnType.columns.map(c => `${c.name}: ${this.getJsType(c.type)}`).join() + "}" + _arr
  }

  getReturnDeser(fn: Schema["functions"][number]) {
    if (typeof fn.returnType === "string") {
      return this.getJsParser(fn.returnType)
    }
  }

  ////////////////////////////////////////////
  // Functions that we
  functions = new Map(Object.values(this.schemas).flatMap(sc => {
    return sc.functions.map(fn => {
      const qualifiedName = `${fn.schemaName}.${fn.name}`
      return [qualifiedName, ({
        ...fn,
        m_params: fn.parameters.map(p => ({
          ...p,
          jsType: this.getJsType(p.type),
          asArgument: `${p.name}: ${this.getJsType(p.type)}`,
        })),
        m_return_type: this.getReturnType(fn),
        m_return_deser: this.getReturnDeser(fn),
        qualifiedName,
      })]
    })
  }))

  relations = new Map(Object.values(this.schemas).flatMap(sc => {
    /** */

    return [...sc.compositeTypes, ...sc.tables, ...sc.views].map(tbl => {

      const tableQualifiedName = `${sc.name}.${tbl.name}`

      /** */
      const m_columns = new Map((tbl.kind === "compositeType" ? [] : tbl.columns).map(c => {

        const fullyTyped = `${c.name}${c.isNullable ? "?" : "!"}: ${this.getJsType(c.expandedType)}` as string
        const withDecorators = `@(${this.getJsParser(c.expandedType)}) ${c.comment ? `/** ${c.comment} */ ` : ""}${fullyTyped} /* pgtype: ${c.expandedType.replace(/pg_catalog\./, "")}, default: ${c.defaultValue} */`

        return [c.name, ({
          ...c,
          kind: tbl.kind === "view" ? "view-column" as const : "table-column" as const,
          qualifiedName: `${tbl.schemaName}.${tbl.name}.${c.name}` as string,
          fullyTyped,
          withDecorators,
        })]
      }))

      const m_foreign_keys_to_others = new Map(Map.groupBy(
        m_columns.values()
          .filter(c => c.references?.length),
        c => c.references![0].name
      ).entries().map(([key, columns]) => {
        const ref = columns[0].references![0]
        const qualifiedDestination = `${ref.schemaName}.${ref.tableName}`
        const strFrom = columns.map(c => c.name).sort().join(",")
        return [strFrom, {
          qualifiedDestination,
          name: ref.name,
          strFrom,
          from: columns.map(c => c.name).sort(),
          strTo: columns.map(c => c.references![0].columnName).sort().join(","),
          to: columns.map(c => c.references![0].columnName).sort(),
        }]
      }))

      const m_foreign_keys_to_others_by_columns = new Map(m_foreign_keys_to_others.values().map(fk =>
        [`${fk.qualifiedDestination}.${fk.strTo}`, fk],
      ))


      const m_primaries = tbl.kind === "table" ? tbl.columns.filter(c => c.isPrimaryKey).map(c => {
        return {
          ...c,
        }
      }) : []

      /** */
      const m_attributes = new Map((tbl.kind === "compositeType" ? tbl.attributes : []).map(a => [a.name, {
        ...a,
        kind: "attribute" as const,
        qualifiedName: `${tbl.schemaName}.${tbl.name}.${a.name}` as string,
      }] as const))

      /** */
      const m_indices = new Map((tbl.kind === "table" ? tbl.indices : []).map(i => [i.name, i]))
      const m_indices_by_columns = new Map(m_indices.values().map(id => [id.columns.map(c => c.name).sort().join(","), id]))

      const m_pk_assign = [...m_primaries.values()].map(c => `${c.name}: this.${c.name}`).join(", ")

      return [tableQualifiedName, {
        ...tbl,
        tableQualifiedName,
        m_indices,
        m_indices_by_columns,
        m_attributes,
        m_columns,
        m_primaries,
        m_pk_assign,
        m_foreign_keys_to_others,
        m_foreign_keys_to_others_by_columns,
        references: [] as Reference[],
      }]
    })
  }))

  all_columns = new Map(this.relations.values().flatMap(v => {
    if (v.kind === "compositeType") {

    }
    return [...v.m_columns.values()] //.map(c => [c.qualifiedName, c])
  }).map(c => [c.qualifiedName, c]))

  all_attributes = new Map(this.relations.values().flatMap(v => {
    if (v.kind === "compositeType") {
      return v.m_attributes.values().map(a => [a.qualifiedName, a])
    }
    return []
  }))

  all_indices = new Map(this.relations.values().flatMap(v => {
    return v.m_indices.values().map(id => [id.name, id])
  }))

  relations_columns = new Map([...this.all_columns.values(), ...this.all_attributes.values()].map(c => [c.qualifiedName, c]))

  functionsIn(...schemas: string[]) {
    const sc = new Set(schemas)
    return this.functions.values().filter(f => sc.has(f.schemaName))
  }

  relationsIn(...schemas: string[]) {
    const sc = new Set(schemas)
    return this.relations.values().filter(r => sc.has(r.schemaName))
  }

  #_init_ = (() => {

    for (let [name, r] of this.relations) {
      // log(r.m_indices)

      if (!this.allowed_schemas.has(r.schemaName)) { continue }

      // For this relation, check with my columns what relation I'm related to
      for (let [columns, def] of r.m_foreign_keys_to_others) {

        const dst = this.relations.get(def.qualifiedDestination)!
        if (!this.allowed_schemas.has(dst.schemaName)) {
          continue
        }

        // console.error(r.name, def)
        const index = dst.m_indices_by_columns.get(def.strTo)
        const toIsUnique = !!index?.isUnique
        const fromIsUnique = !!r.m_indices_by_columns.get(def.strFrom)?.isUnique

        const distantName = toIsUnique && def.from.length === 1 ? def.strFrom.replace(/(_id|s)$/, "") : dst.name

        r.references.push({
          pgtsName: `$${distantName}:${dst.name}!${def.name}`,
          distantName,
          toTableObject: dst,
          toTable: def.qualifiedDestination,
          toTableSimpleName: dst.name,
          fromColumnsStr: columns,
          toColumnsStr: def.strTo,
          toColumns: def.to,
          fromColumns: def.from,
          toIsUnique,
          fromIsUnique
        })

        // let backName = r.name + (!fromIsUnique && r.name[r.name.length - 1] !== "s" ? "s" : "") + (def.to.length === 1 ? "_by_" + def.strFrom : "")
        let backName = r.name + (!fromIsUnique && r.name[r.name.length - 1] !== "s" ? "s" : "") // + (def.to.length === 1 ? "_by_" + def.strFrom : "")

        dst.references.push({
          pgtsName: `$${backName}:${r.name}!${def.name}`,
          distantName: backName,
          toTableObject: r,
          toTable: r.tableQualifiedName,
          toTableSimpleName: r.name,
          fromColumnsStr: def.strTo,
          fromColumns: def.to,
          toColumnsStr: def.strFrom,
          toColumns: def.from,
          toIsUnique: fromIsUnique,
          fromIsUnique: toIsUnique,
        })

      }

    }

    for (let r of this.relations.values()) {
      for (let ref of Map.groupBy(r.references, e => `${e.toTable}.${e.distantName}`)
        .values().filter(to => to.length > 1).flatMap(r => r)) {
          ref.distantName = `${ref.distantName}_from_${ref.toColumnsStr}`
      }
    }
  })()
}


const cmd = command({
  name: "pgts",
  description: `
  Generate typescript code to use with a PostgresT server.
`,
  args: {
    uri: positional({ displayName: "pg-uri", description: "The database URI" }),
    debug: flag({
      long: "debug",
      description: "Do not write the result, just debug information",
      type: boolean
    }),
    out: option({
      long: "outfile",
      short: "o",
      description: "The file to overwrite. If - or not provided, output on stdout",
      type: optional(string),
    }),
    schemas: multioption({
      long: "schemas",
      short: "s",
      description: "The schemas to include",
      type: array(string),
    })
  },
  async handler(opts) {
    const sc = await extractSchemas(opts.uri)
    const s = new SchemaDetails(sc, opts.schemas)

    const blocks = new ImplBlocks(opts.out)

    // console.log(blocks.blocks)
    ;const result = (js_beautify(build`/**
      * WARNING
      * THIS FILE WAS GENERATED BY pgts@${version}
      * ONLY EDIT CODE BETWEEN !impl and !end impl comments
      * https://github.com/ceymard/pgts
      */

      import { s, } from "@salesway/pgts"
      import * as p from "@salesway/pgts"

      ${blocks.show("FILE_HEADER")}


      ${s.functionsIn(...opts.schemas).map(v =>
      `/** ${v.comment ?? ""} */
      export async function ${v.name}(${v.m_params.enumerate("asArgument")}): Promise<${v.m_return_type}> {
        return p.POST("api", "/pg/rpc/${v.name}", {${v.m_params.enumerate("name")}})
      }
      `)}


      ${s.relationsIn(...opts.schemas).map(v => build`
        /**
         * Table ${v.schemaName}.${v.name}
          ${v.comment}
        */
        export class ${CamelCase(v.name)} extends p.Model {

          ${v.references.map(r => `@(p.rel("${r.pgtsName}")) @(s.embed(() => ${CamelCase(r.toTableSimpleName)})${!r.toIsUnique ? ".array" : ""}.ro) $${r.distantName}!: ${CamelCase(r.toTableSimpleName)}${!r.toIsUnique ? "[]" : ""}`)}

          static meta = {
            url: "/pg/${v.name}",
            schema: "${v.schemaName}",
            pk_fields: [${v.m_primaries.map(p => `"${p.name}"`).join(", ")}]${v.m_primaries.length === 0 ? " as string[]" : ""},
            rels: {${v.references.map(r => `$${r.distantName}: "${r.pgtsName}"`).join(", ")}},
          }

          ${v.m_primaries.length === 0 ? "" : build`get __pk() {
            return {${v.m_pk_assign}}
          }`}

          ${v.m_columns.values().map(c => c.withDecorators)}

          ${blocks.show(CamelCase(v.name))}
        }
        `)}
      `, {
        indent_size: 2,
        wrap_line_length: 120,
        operator_position: "after-newline",
        e4x: true, break_chained_methods: true
      }
    ))

    if (opts.out && !opts.debug) {
      writeFileSync(opts.out, result, "utf-8")
    }

    if (opts.debug) {
      console.log(result)
    }
  }
})

run(cmd, process.argv.slice(2))

// class A {
//   b!: string
//   dddd!: string
// }

// class B {
//   a!: A
//   ccc!: C
// }

// class C {
//   aaa!: A
// }

// type Fields1 = "aaaa" | "bbbb"
// type Fields2 = "cccc" | "dddd"
// type Key<T> = Extract<keyof T, string>
// type test<M, T extends string> =
//   // T extends `${Key<M>}.${test<infer U>}`
// // const p: test = "aaaa as cccc"
// function _test<T>(p: test<T, Extract<keyof T, string>>) {
// }
// _test<C>("aaa.b")