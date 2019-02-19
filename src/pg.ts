import { Client } from 'pg'
import { inspect } from 'util'
import * as path from 'path'
import * as fs from 'fs'

const DB = 'postgres://administrator:admin@172.18.0.2/app'
const SCHEMA = 'api'


export function log(m: any) {
  console.warn(inspect(m, {colors: true, depth: null}))
}

export interface ColumnResult {
  table_catalog: string
  table_schema: string
  table_name: string
  column_name: string
  ordinal_position: number
  column_default: string // expression à parser ?
  is_nullable: 'YES' | 'NO'
  data_type: string // This is what we want !
  udt_catalog: string
  udt_schema: string // this is where we would want to go fetch our custom types if we had some
  udt_name: string // with this name.
  is_updatable: 'YES' | 'NO'
  comment: string | null
}


export interface Parameter {
  parameter_name: string
  udt_name: string
}


function camelcase(s: string) {
  return s[0].toUpperCase() + s.slice(1).replace(/_([\w])/g, (match, l) => l.toUpperCase())
}

function handle_udt_name(s: string) {
  // log(s)
  var arr = (s[0] === '_')
  if (arr)
    s = s.slice(1)
  var type = s

  if (s.match(/^(int|float)\d+$/))
    type = 'number'
  else if (s === 'text')
    type = 'string'
  else if (s === 'date' || s === 'timestamp')
    type = 'Date | string'
  else if (s === 'bool')
    type = 'boolean'
  else if (s === 'void')
    type = 'void'
  else
    type = camelcase(s)
  return type + (arr ? '[]' : '')
}

function handle_default_value(s: string) {
  var m: RegExpExecArray | null
  if (m = /'(.*)'::json/.exec(s) || /(.*)::text$/.exec(s)) {
    return m[1]
  }
  if (m = /'\{\}'::text\[\]/.exec(s)) {
    return '[]'
  }
  return `undefined! // ${s}`
}

export function udt(name: string) {
  return handle_udt_name(name).replace(/^./, m => m.toUpperCase())
}


async function run() {
  const c = new Client(DB)
  // console.log('wha')
  await c.connect()

  await c.query(`SET SCHEMA '${SCHEMA}'`)

  // console.log('connected')

  const res = await c.query(`
    SELECT
      t.table_name,
      d.description as comment,
      (SELECT json_agg(T) FROM (
        SELECT
          c.*,
          d2.description as comment
        FROM information_schema.columns c
          LEFT JOIN pg_description d2
            ON d2.objoid = ($1 || '.' || t.table_name)::regclass::oid AND d2.objsubid = c.ordinal_position
        WHERE
          c.table_schema = t.table_schema
          AND c.table_name = t.table_name
      ) T) as columns
    FROM
      information_schema.tables t
      LEFT JOIN pg_description d ON d.objoid = ($1 || '.' || t.table_name)::regclass::oid AND d.objsubid = 0
    WHERE
      table_schema = $1
  `, [SCHEMA])

  const rows = res.rows as {table_schema: string, table_name: string, comment: string | null, columns: ColumnResult[]}[]
  // log(rows)

  // process.exit(0)

  const out = process.stdout
  out.write(fs.readFileSync(path.join(__dirname, '../src/prelude.ts'), 'utf-8'))

  for (var r of rows) {
    if (r.comment) {
      out.write(`/**\n${r.comment.split('\n').map(c => ` * ${c}`).join('\n')}\n */\n`)
    }
    console.log('export class', camelcase(r.table_name), 'extends Model {')
    console.log(`  static url = '/pg/${r.table_name}'\n`)
    for (var col of r.columns) {
      if (col.comment) {
        out.write(`  /**\n`)
        out.write(col.comment.split('\n').map(c => `   * ${c}`).join('\n'))
        out.write(`\n   */\n`)
      }
      out.write(`  ${col.column_name}: `)
      // console.log(col.udt_name)
      out.write(handle_udt_name(col.udt_name))
      if (col.is_nullable === 'YES') {
        out.write(' | null')
      }
      if (col.column_default) {
        out.write(` = ${handle_default_value(col.column_default)}`)
      } else if (col.is_nullable == 'YES') {
        out.write(` = null`)
      } else {
        out.write(` = undefined!`)
      }
      out.write('\n')
    }
    console.log(`\n  /** !impl ${camelcase(r.table_name)} **/`)
    console.log(`    // extend this class here`)
    console.log(`  /** !end impl **/`)
    console.log('}\n\n')
  }

  const functions_new = await c.query(/* sql */`
    SELECT
      pro.proname as name,
      pro.proargmodes::text[] as arg_modes,
      pro.proargnames::text[] as arg_names,
      typ2.typname as rettype,
      typ2.typrelid as relid,
      COALESCE(JSON_AGG(json_build_object('type', typ.typname, 'notnull', typ.typnotnull) ORDER BY ordinality) FILTER (WHERE typ.typname IS NOT NULL), '[]') as args
    FROM pg_namespace name
    INNER JOIN pg_proc pro
      ON pro.pronamespace = name.oid
      LEFT JOIN unnest(COALESCE(pro.proallargtypes, pro.proargtypes)) WITH ORDINALITY as u(type_oid, ordinality) ON true
      LEFT JOIN pg_type typ ON typ.oid = type_oid
      INNER JOIN pg_type typ2 ON typ2.oid = pro.prorettype
    WHERE name.nspname = $1 AND typ2.typname <> 'trigger'
    GROUP BY pro.proname, pro.proargmodes, pro.proargnames, typ2.typname, typ2.typrelid
  `, [SCHEMA])
  // information_schema.routines
  // information_schema.parameters

  for (var f2 of functions_new.rows) {
    const therow = f2 as {name: string, arg_names: string[], arg_modes: string[], rettype: string, relid: number, args: {type: string, notnull: boolean}[]}
    var args = therow.args.map(a => handle_udt_name(a.type))
    var notnulls = therow.args.map(a => !!a.notnull)
    var names = therow.arg_names
    var result = handle_udt_name(therow.rettype)

    // If we have a relid, it means this function is returning a table row type
    // Postgrest seems to think this means we will return an array.
    if (therow.relid)
      result = result + '[]'

    if (therow.rettype === 'record') {
      // Find first argument which is table
      var idx = therow.arg_modes.indexOf('t')
      var resargs = args.slice(idx)
      var resnames = names.slice(idx)
      var notnulls = notnulls.slice(idx)
      args = args.slice(0, idx)
      names = names.slice(0, idx)
      result = `{${resargs.map((t, i) => `${resnames[i]}: ${t}${!notnulls[i] ? ' | null' : ''}`).join(', ')}}[]`
    }

    var final_args = args.map((a, i) => `${names[i]}: ${a}`).join(', ')
    // console.log(therow.name, final_args, result)

    out.write(`export function ${therow.name}(${final_args}): Promise<${result}> {\n`)
    out.write(`  /** !impl ${therow.name}**/\n`)
    out.write(`  return POST('/pg/rpc/${therow.name}', JSON.stringify({${(names||[]).join(', ')}}))\n`)
    out.write(`  /** !end impl **/\n`)
    out.write('\n}\n\n')
  }

  await c.end()
}

run().catch(e => console.error(e))
