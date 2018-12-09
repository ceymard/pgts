
export interface Model<T> {
  new(): T
  url: string
}

export class QueryBuilder<T> {



  constructor(public model: Model<T>) {

  }

  async fetch(): Promise<T[]> {
    return []
  }
}

