let initialized = false

export default {
  async init() {
    initialized = true
  },
  async checkImage() {
    if (!initialized) {
      throw new Error('mock plugin not initialized')
    }
    return {
      flagged: false,
      top_score_name: 'mock',
      top_score_value: 0,
    }
  },
}
