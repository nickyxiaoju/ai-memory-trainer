/* ---------- IndexedDB 存储层 -------------------------------------------- */
/**
 * 工作台教材与复习记录持久化。
 * 两张表分开：documents 存教材内容，reviews 存复习进度，换教材不丢复习记录。
 */
const DB = {
  name: 'folio-db',
  version: 1,
  db: null,

  /** 打开数据库，返回 Promise */
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'docId' });
        }
        if (!db.objectStoreNames.contains('reviews')) {
          db.createObjectStore('reviews', { keyPath: 'checkpointId' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /** 通用事务封装：fn 返回 IDBRequest 时自动取其 result，返回 Promise 时自动 await */
  async tx(storeName, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = fn(store);
      // store.get/put/delete 返回 IDBRequest，必须等事务完成再读 request.result，
      // 直接 resolve(request) 会把「请求对象」当数据交给调用方（曾导致打开教材拿到空对象、点击无反应）。
      const isReq = result && typeof result === 'object' && 'readyState' in result;
      tx.oncomplete = () => resolve(isReq ? result.result : result);
      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = (e) => reject(e.target.error);
    });
  },

  /* ---------- 教材（documents） ---------- */
  async saveDocument(doc) {
    return this.tx('documents', 'readwrite', (store) => store.put(doc));
  },

  async getDocument(docId) {
    return this.tx('documents', 'readonly', (store) => store.get(docId));
  },

  async listDocuments() {
    return this.tx('documents', 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  },

  async deleteDocument(docId) {
    return this.tx('documents', 'readwrite', (store) => store.delete(docId));
  },

  /* ---------- 复习记录（reviews） ---------- */
  async saveReview(review) {
    return this.tx('reviews', 'readwrite', (store) => store.put(review));
  },

  async getReview(checkpointId) {
    return this.tx('reviews', 'readonly', (store) => store.get(checkpointId));
  },

  async listReviewsByDoc(docId) {
    return this.tx('reviews', 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          resolve(all.filter(r => r.docId === docId));
        };
        req.onerror = () => resolve([]);
      });
    });
  },

  /** 复习今日要跨教材取全部记录，按 docId 过滤交给调用方 */
  async listReviews() {
    return this.tx('reviews', 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  },

  async deleteReview(checkpointId) {
    return this.tx('reviews', 'readwrite', (store) => store.delete(checkpointId));
  },

  /** 清除全部数据（调试用） */
  async clearAll() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction(['documents', 'reviews'], 'readwrite');
      tx.objectStore('documents').clear();
      tx.objectStore('reviews').clear();
      tx.oncomplete = () => resolve();
    });
  }
};
