import { readFileSync } from "fs"

export class ImplBlocks {

  contents: string = ""
  blocks: Map<string, string> = new Map()

  constructor(
    public fpath?: string
  ) {
    if (fpath) {
      this.contents = readFileSync(fpath, "utf-8")
      const re_search = /\/\*\*\s*!impl\s+([^\s]+)\s*\*\*\/([^]*?)\/\*\*\s*!end impl [^]*?\*\*\//gm
      // const re_search = /\/\/\*\* !impl (?<name>[\w]+) \*\*\/(?<content>[^]*?)\/\/\*\* !end impl \k<name> \*\*\//g
      this.blocks = new Map(
        this.contents.matchAll(re_search)
        .map(([_, blk, cts]) => [blk, cts])
      )
    }
  }

  show(name: string) {
    return `/** !impl ${name} **/${this.blocks.get(name) ?? "\n\n"}/** !end impl ${name} **/`
  }
}
