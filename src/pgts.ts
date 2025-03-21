#!/usr/bin/env bun

import { inspect } from "util"
import { CompositeTypeAttribute, extractSchemas, Schema, TableColumn, ViewColumn } from "extract-pg-schema"
import { array, boolean, command, flag, multioption, option, optional, positional, run, string } from "cmd-ts"
import { writeFileSync } from "fs"
import { version } from "../package.json"
import { ImplBlocks } from "./blocks"
import { format } from "prettier"


type SingleRenderable = number | string | null | undefined | false | SingleRenderable[] | Iterable<SingleRenderable>
// type Renderable = SingleRenderable | SingleRenderable[]

interface EnumerateOptions {
  quote?: boolean
}

declare global {

  interface Array<T> {
    enumerate(key: (keyof T) | ((v: T) => string), opts?: EnumerateOptions): Iterable<string>
  }
  // interface Iterator<T> {
  //   enumerate(key: (keyof T) | ((v: T) => string), opts?: EnumerateOptions): Iterable<string>
  // }
}

Array.prototype.enumerate = function enumerate<T>(key: (keyof T) | ((v: T) => string), opts: EnumerateOptions = {}): Iterable<string> {
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
    // writeFileSync("./output.json", JSON.stringify(schemas, null, 2))
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
  fromIsNullable: boolean
}


class SchemaDetails extends SchemaBase {

  allowed_schemas = new Set(this.allowed_schemas_str)

  getJsType(type: string) {
    const is_array = type.match(/\[\]/)
    type = type.replace(/[^.]+\.|\[\]/g, "")
    return (match(
      [/text|name/, "string"],
      [/bool(ean)?/, "boolean"],
      [/(big)?int\d*?|numeric|float\d*?/, "number"],
      [/timestamp(tz)?|date/, "Date"],
      [/^jsonb?$/, "any"],
    )(type) ?? CamelCase(type)) + (is_array ? "[]" : "")
  }

  getJsParser(type: string) {
    const is_array = type.match(/\[\]/)
    type = type.replace(/[^.]+\.|\[\]/g, "")

    const res = (match(
      [/text|name/, "s.str"],
      [/bool(ean)?/, "s.bool"],
      [/int\d*?|numeric|float\d*?/, "s.num"],
      [/timestamp(tz)?|date/, "s.date"],
      [/^jsonb?$/, "s.as_is"],
    )(type) ?? `s.embed(() => ${CamelCase(type)})`) + (is_array ? ".array" : "")
    return res
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

  getTryGetDefault(c: TableColumn | ViewColumn) {
    const def = c.defaultValue
    if (c.isNullable) {
      return "null"
    }
    if (c.isArray) {
      return "[]"
    }
    if (/'::text$/.test(def)) {
      return "\"" + def.slice(1, -7).replaceAll("''", "'") + "\""
    }
    if (/^\d+(\.\d+)?$/.test(def)) {
      return Number(def)
    }
    if (def === "CURRENT_TIMESTAMP") {
      return "new Date()"
    }
    return "undefined!"
  }

  functions_array = Object.values(this.schemas).flatMap(sc => {
    return sc.functions.map(fn => {
      const qualifiedName = `${fn.schemaName}.${fn.name}`
      return ({
        ...fn,
        m_params: fn.parameters.map(p => ({
          ...p,
          jsType: this.getJsType(p.type),
          asArgument: `${p.name}: ${this.getJsType(p.type)}`,
        })),
        m_return_type: this.getReturnType(fn),
        m_return_deser: this.getReturnDeser(fn),
        qualifiedName,
      })
    })
  })

  ////////////////////////////////////////////
  // Functions that we
  functions = new Map(this.functions_array.map((fn) => {
    return [fn.qualifiedName, fn]
  }))

  relations = new Map(Object.values(this.schemas).flatMap(sc => {
    /** */

    return [...sc.compositeTypes, ...sc.tables, ...sc.views].map(tbl => {

      const tableQualifiedName = `${sc.name}.${tbl.name}`

      /** */
      const m_columns = new Map((tbl.kind === "compositeType" ? [] : tbl.columns).map(c => {

        const fullyTyped = `${c.name}: ${this.getJsType(c.expandedType)}${c.isNullable ? " | null" : ""}` as string
        const withDecorators = `@(${this.getJsParser(c.expandedType)}) ${c.comment ? `/** ${c.comment} */ ` : ""}${fullyTyped} = ${this.getTryGetDefault(c)} /* pgtype: ${c.expandedType.replace(/pg_catalog\./, "")}, default: ${c.defaultValue} */`

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

  functions_for_tables = Map.groupBy(
    this.functions_array.filter(f => f.parameters.length === 1
      && this.relations.has(f.parameters[0].type)
      && !f.returnsSet
    ),
    f => f.parameters[0].type
    )

  #init = (() => {
    for (let [name, sc] of Object.entries(this.schemas)) {
      for (let f of sc.functions) {
        if (f.parameters.length === 1 && f.schemaName === "api") {
          console.error(f.schemaName,".", f.name)
          // this.functions_for_tables.set(f.parameters[0].type, f)
        }
      }
    }
    // console.error(this.functions_for_tables.size)
    console.error(...this.functions_for_tables.values().map(fn => fn.map(f => f.qualifiedName)))
    console.error(...this.functions_array.values().filter(f => f.schemaName === "api").map(fn => fn.qualifiedName))
  })()

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
        const hint = toIsUnique && def.from.length === 1 ? def.strFrom : `${dst.name}!${def.name}`
        // console.error(hint)

        r.references.push({
          pgtsName: `$${distantName}:${hint}`,
          distantName,
          toTableObject: dst,
          toTable: def.qualifiedDestination,
          toTableSimpleName: dst.name,
          fromColumnsStr: columns,
          toColumnsStr: def.strTo,
          toColumns: def.to,
          fromColumns: def.from,
          toIsUnique,
          fromIsUnique,
          fromIsNullable: def.from.some(c => r.m_columns.get(c)?.isNullable),
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
          fromIsNullable: def.to.some(c => r.m_columns.get(c)?.isNullable),
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
    ;let result = (build`/**
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
        export namespace ${CamelCase(v.name)} {
          export interface Create {
            ${[...v.m_columns.values()].map(c => `${c.name}${c.isNullable || c.defaultValue ? "?" : ""}: ${s.getJsType(c.expandedType)}`).join("\n")}
          }

          export interface Result {
            $: ${CamelCase(v.name)}
            ${v.references.map(r => `$${r.distantName}: ${CamelCase(r.toTableObject.name)}.Result${r.toIsUnique ? "" : "[]"}${r.fromIsNullable ? " | null" : ""}`).join("\n")}
          }
        }


        /**
         * Table ${v.schemaName}.${v.name}
          ${v.comment}
        */
        export class ${CamelCase(v.name)} extends p.Model {

          static meta = {
            url: "/pg/${v.name}",
            schema: "${v.schemaName}",
            pk_fields: [${v.m_primaries.map(p => `"${p.name}" as const`).join(", ")}]${v.m_primaries.length === 0 ? " as string[]" : ""},
            rels: {${v.references.map(r => `$${r.distantName}: {name: "${r.pgtsName}", nullable: ${r.fromIsNullable ? "true" : "false"} as const, is_array: ${r.toIsUnique ? "false" : "true"} as const, model: () => ${CamelCase(r.toTableObject.name)}, to_columns: [${r.toColumns.map(c => `"${c}"`).join(", ")}], from_columns: [${r.fromColumns.map(c => `"${c}"`).join(", ")}] }`).join(", ")}},
            columns: [${[...v.m_columns.values()].map(c => `"${c.name}"`).join(", ")}] as (${[...v.m_columns.values()].map(c => `"${c.name}"`).join(" | ")})[],
            computed_columns: [${[...(s.functions_for_tables.get(v.tableQualifiedName)?.values() ?? [])].map(c => `"${c.name}"`).join(", ")}] as (${[...(s.functions_for_tables.get(v.tableQualifiedName)?.values() ?? [])].map(c => `"${c.name}"`).join(" | ") || "string"})[],
          }

          ${v.m_primaries.length === 0 ? "" : build`get __pk() {
            if (${v.m_primaries.map(p => `this.${p.name} == null`).join(" || ")}) { return undefined }
            return {${v.m_pk_assign}}
          }`}

          ${v.m_indices.values().filter(i => i.isUnique).map(i => i.columns.length === 1 ? `get __strkey_${i.name}() { return ""+this.${i.columns[0].name} }` : `get __strkey_${i.name}() { return \`\$\{${i.columns.map(c => `this.${c.name}`).join("}␟\$\{")}\}\` }`)}

          ${v.m_indices.values().filter(i => i.isPrimary).map(i => i.columns.length === 1 ? `get __strkey_pk() { return ""+this.${i.columns[0].name} }` : `get __strkey_pk() { return \`\$\{${i.columns.map(c => `this.${c.name}`).join("}␟\$\{")}\}\` }`)}

          ${v.m_columns.values().map(c => c.withDecorators)}

          ${s.functions_for_tables.get(v.tableQualifiedName)?.map(f => `@(${s.getReturnDeser(f)}.ro) ${f.name}!: ${s.getReturnType(f)}`) ?? ""}

          ${blocks.show(CamelCase(v.name))}
        }
        `)}
      `)

      if (opts.debug) {
        console.log(result)
      }

    result = await format(result, {
      parser: "typescript",
      printWidth: 240,
      tabWidth: 2,
      useTabs: false,
    })

    if (opts.out && !opts.debug) {
      writeFileSync(opts.out, result, "utf-8")
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