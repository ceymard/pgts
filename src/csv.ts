
export class CsvParser {
  constructor(
    public col_cbk: (content: string | null, col_index: number) => void,
    public line_cbk: () => void,
    public end_at_undefined = false,
    public col_index = 0,
    public quoted = false,
    public in_quote = false,
    public escaped = false,
    public leftovers: string[] | null = null,
  ) { }

  reset() {
    this.col_index = 0
    this.quoted = false
    this.in_quote = false
    this.escaped = false
    this.leftovers = null
  }

  handleColumn(v: string | null) {
    if (this.quoted) {
      this.quoted = false
      v = v!.slice(1, -1)
    }
    if (this.escaped) {
      v = v!.replace(/""/g, '"')
    }

    this.col_cbk(v, this.col_index)
    this.col_index++

  }

  parse(txt: string) {
    let prev = 0
    let i = 0

    prev = i
    do {
      const c = txt[i++]

      if (this.in_quote) {
        // attention si on est sur une boundary !
        if (c === '"' && c[i] === '"') {
          this.escaped = true
        } else if (c === '"') {
          this.in_quote = false
        }
        continue
      }

      if (c === '"' && i === prev + 1) {
        this.quoted = true
        this.in_quote = true
        this.escaped = false
        // this is the start of a quoted field
      }

      if (c === ',' || c === '\n' || c === undefined && this.end_at_undefined) {
        let v: string | null = txt.slice(prev, i - 1)

        if (this.leftovers != null) {
          this.leftovers.push(v)
          v = this.leftovers.join("")
          this.leftovers = null
        }

        if (prev === i - 1) { v = null }
        this.handleColumn(v)
        prev = i
      }

      if (c === '\n' || c === undefined && this.end_at_undefined) {
        this.col_index = 0
        this.line_cbk()
      }

      if (c === undefined) {
        if (!this.end_at_undefined) {
          this.leftovers ??= []
          this.leftovers.push(txt.slice(prev, i -1))
        }
        // Check that we have leftovers
        break
      }

    } while (true)

  }

  end() {
    if (this.leftovers == null || this.leftovers.length === 0) { return }
    const v = this.leftovers.join("")
    this.handleColumn(v.length === 0 ? null : v)
    this.line_cbk()
  }
}


export async function get_csv<Columns extends {[name: string]: (s: string) => any}, Inst = {[K in keyof Columns]: ReturnType<Columns[K]>}>(
  url: string,
  columns: Columns,
  mkdef: () => Inst = () => ({} as Inst),
): Promise<Inst[]> {

  const req = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "text/csv",
    }
  })

  const headers: string[] = []
  const cols: ((s: string) => any)[] = []

  function read_header_column(col: string | null, idx: number) {
    headers.push(col!)
    cols.push(columns[col!])
  }

  function end_headers() {
    parser.col_cbk = read_column
    parser.line_cbk = end_line
  }

  const result: Inst[] = []
  let line = mkdef()
  function read_column(col: string | null, idx: number) {
    (line as any)[headers[idx]] = col != null ? cols[idx]?.(col) ?? col : null
  }

  function end_line() {
    result.push(line)
    line = mkdef()
  }

  const parser = new CsvParser(
    read_header_column,
    end_headers,
  )

  const reader = req.body!.pipeThrough(new TextDecoderStream()).getReader()
  while (true) {
    // this is where we
    const {done, value} = await reader.read()
    if (value) {
      parser.parse(value.toString())
    }
    if (done) {
      parser.end()
      break
    }
  }

  return result
}

const num = (s: string) => Number(s)
const str = (s: string) => s
const bool = (s: string) => s?.[0] === "t"
const date = (s: string) => new Date()
