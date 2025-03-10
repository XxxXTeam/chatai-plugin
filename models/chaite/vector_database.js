import { LocalIndex } from 'vectra'
import { md5 } from '../../utils/common.js'

/**
 * 基于Vectra实现的简单向量数据库，作为默认实现
 */
class VectraVectorDatabase {
  constructor (indexFile) {
    this.index = new LocalIndex(indexFile)
    this.init()
  }

  async init () {
    if (!(await this.index.isIndexCreated())) {
      await this.index.createIndex()
    }
  }

  async addVector (vector, text) {
    const id = md5(text)
    await this.index.insertItem({
      vector,
      id,
      metadata: { text }
    })
    return id
  }

  /**
   *
   * @param vectors
   * @param texts
   * @returns {Promise<string[]>}
   */
  async addVectors (vectors, texts) {
    return await Promise.all(vectors.map((v, i) => this.addVector(v, texts[i])))
  }

  /**
   *
   * @param queryVector
   * @param k
   * @returns {Promise<Array<{ id: string, score: number, text: string }>>}
   */
  async search (queryVector, k) {
    const results = await this.index.queryItems(queryVector, k)
    return results.map(r => ({ id: r.item.id, score: r.score, text: r.item.metadata.text }))
  }

  /**
   *
   * @param id
   * @returns {Promise<{ vector: number[], text: string } | null>}
   */
  async getVector (id) {
    const result = await this.index.getItem(id)
    return {
      vector: result.vector,
      text: result.metadata.text
    }
  }

  async deleteVector (id) {
    await this.index.deleteItem(id)
    return true
  }

  async updateVector (id, newVector, newText) {
    await this.index.upsertItem({
      id,
      vector: newVector,
      metadata: { text: newText }
    })
    return true
  }

  async count () {
    return (await this.index.getIndexStats()).items
  }

  async clear () {
    await this.index.deleteIndex()
  }
}

/**
 * 默认向量库 todo
 * @type {import('chaite').VectorDatabase}
 */
export const ChatGPTVectorDatabase = new VectraVectorDatabase()
