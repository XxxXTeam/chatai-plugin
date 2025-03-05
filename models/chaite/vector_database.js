// todo
class FaissVectorDatabase {
  constructor (index) {
    this.index = index
  }

  async addVector (vector, text) {
  }

  async addVectors (vectors, texts) {
  }

  async search (queryVector, k) {
  }

  async getVector (id) {
  }

  async deleteVector (id) {
  }

  async updateVector (id, newVector, newText) {
  }

  async count () {
  }

  async clear () {
  }
}

/**
 * 默认向量库
 * @type {import('chaite').VectorDatabase}
 */
export const ChatGPTVectorDatabase = new FaissVectorDatabase()
