const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let db;
let isMock = false;

// Check if environmental configuration is available
const hasEnvConfig = 
  process.env.FIREBASE_PROJECT_ID && 
  process.env.FIREBASE_CLIENT_EMAIL && 
  process.env.FIREBASE_PRIVATE_KEY;

if (hasEnvConfig) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      })
    });
    db = admin.firestore();
    console.log("Firebase Admin successfully initialized with environment credentials.");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin using environment keys, falling back to mock mode:", error.message);
    setupMockFirestore();
  }
} else {
  // Check if a local serviceAccountKey.json file exists
  const localKeyPath = path.join(__dirname, "../serviceAccountKey.json");
  if (fs.existsSync(localKeyPath)) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(localKeyPath)
      });
      db = admin.firestore();
      console.log("Firebase Admin initialized with local serviceAccountKey.json file.");
    } catch (err) {
      console.error("Failed to read local serviceAccountKey.json, falling back to mock mode:", err.message);
      setupMockFirestore();
    }
  } else {
    console.warn("No Firebase credentials found. Running in MOCK FIRESTORE mode (data will be saved locally to backend/db_mock.json).");
    setupMockFirestore();
  }
}

function setupMockFirestore() {
  isMock = true;
  const mockDbPath = path.join(__dirname, "../db_mock.json");
  
  // Ensure mock db file exists with default schema
  if (!fs.existsSync(mockDbPath)) {
    const defaultData = {
      users: {},
      settings: {
        global: {
          monthlyPrice: 4.99,
          yearlyPrice: 29.99,
          lifetimePrice: 79.99,
          trialDays: 10,
          extensionVersion: "1.0.0",
          maintenanceMode: false,
          announcements: "Welcome to Advanced Auto Refresh Premium!",
          enablePremiumFeatures: true
        }
      }
    };
    fs.writeFileSync(mockDbPath, JSON.stringify(defaultData, null, 2), "utf8");
  }

  // Load mock data helper
  const readData = () => {
    try {
      return JSON.parse(fs.readFileSync(mockDbPath, "utf8"));
    } catch (e) {
      return { users: {}, settings: {} };
    }
  };

  const writeData = (data) => {
    fs.writeFileSync(mockDbPath, JSON.stringify(data, null, 2), "utf8");
  };

  // Build high-fidelity mock Firestore class structure
  class MockDocumentReference {
    constructor(collectionPath, docId) {
      this.collectionPath = collectionPath;
      this.id = docId;
    }

    async get() {
      const data = readData();
      const col = data[this.collectionPath] || {};
      const docData = col[this.id];
      return {
        id: this.id,
        exists: !!docData,
        data: () => docData ? JSON.parse(JSON.stringify(docData)) : undefined
      };
    }

    async set(value, options = {}) {
      const data = readData();
      if (!data[this.collectionPath]) {
        data[this.collectionPath] = {};
      }
      
      let merged = value;
      if (options.merge && data[this.collectionPath][this.id]) {
        merged = { ...data[this.collectionPath][this.id], ...value };
      }
      
      // Convert any Firestore timestamps or Dates to ISO strings in mock mode
      const sanitize = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        const res = Array.isArray(obj) ? [] : {};
        for (const k in obj) {
          if (obj[k] instanceof Date) {
            res[k] = obj[k].toISOString();
          } else if (obj[k] && typeof obj[k] === "object" && obj[k].toDate) {
            res[k] = obj[k].toDate().toISOString();
          } else if (typeof obj[k] === "object") {
            res[k] = sanitize(obj[k]);
          } else {
            res[k] = obj[k];
          }
        }
        return res;
      };

      data[this.collectionPath][this.id] = sanitize(merged);
      writeData(data);
      return { id: this.id };
    }

    async update(value) {
      return this.set(value, { merge: true });
    }

    async delete() {
      const data = readData();
      if (data[this.collectionPath] && data[this.collectionPath][this.id]) {
        delete data[this.collectionPath][this.id];
        writeData(data);
      }
    }
  }

  class MockQuery {
    constructor(collectionPath, filters = [], sortField = null, sortDir = "asc", limitCount = null) {
      this.collectionPath = collectionPath;
      this.filters = filters;
      this.sortField = sortField;
      this.sortDir = sortDir;
      this.limitCount = limitCount;
    }

    where(field, op, value) {
      return new MockQuery(
        this.collectionPath, 
        [...this.filters, { field, op, value }], 
        this.sortField, 
        this.sortDir, 
        this.limitCount
      );
    }

    orderBy(field, dir = "asc") {
      return new MockQuery(
        this.collectionPath, 
        this.filters, 
        field, 
        dir, 
        this.limitCount
      );
    }

    limit(count) {
      return new MockQuery(
        this.collectionPath, 
        this.filters, 
        this.sortField, 
        this.sortDir, 
        count
      );
    }

    async get() {
      const data = readData();
      const col = data[this.collectionPath] || {};
      let docs = Object.keys(col).map(id => ({
        id: id,
        data: () => JSON.parse(JSON.stringify(col[id]))
      }));

      // Apply simple filters
      for (const filter of this.filters) {
        docs = docs.filter(doc => {
          const docVal = doc.data()[filter.field];
          const testVal = filter.value;
          if (filter.op === "==") return docVal === testVal;
          if (filter.op === ">=") return docVal >= testVal;
          if (filter.op === "<=") return docVal <= testVal;
          if (filter.op === ">") return docVal > testVal;
          if (filter.op === "<") return docVal < testVal;
          if (filter.op === "array-contains") return Array.isArray(docVal) && docVal.includes(testVal);
          return true;
        });
      }

      // Apply sorting
      if (this.sortField) {
        docs.sort((a, b) => {
          const valA = a.data()[this.sortField];
          const valB = b.data()[this.sortField];
          if (valA === undefined) return 1;
          if (valB === undefined) return -1;
          if (valA < valB) return this.sortDir === "asc" ? -1 : 1;
          if (valA > valB) return this.sortDir === "asc" ? 1 : -1;
          return 0;
        });
      }

      // Apply limit
      if (this.limitCount !== null) {
        docs = docs.slice(0, this.limitCount);
      }

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (callback) => docs.forEach(callback)
      };
    }
  }

  db = {
    collection: (collectionPath) => {
      return {
        doc: (docId) => new MockDocumentReference(collectionPath, docId),
        get: async () => {
          const q = new MockQuery(collectionPath);
          return q.get();
        },
        where: (field, op, value) => {
          const q = new MockQuery(collectionPath);
          return q.where(field, op, value);
        },
        orderBy: (field, dir) => {
          const q = new MockQuery(collectionPath);
          return q.orderBy(field, dir);
        },
        limit: (count) => {
          const q = new MockQuery(collectionPath);
          return q.limit(count);
        }
      };
    }
  };
}

module.exports = {
  db,
  isMock,
  // Helper to standardise timestamps between actual Firebase and mock ISO strings
  getTimestampDate: (val) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === "function") {
      return val.toDate();
    }
    if (typeof val === "string") {
      return new Date(val);
    }
    if (val._seconds) {
      return new Date(val._seconds * 1000);
    }
    return new Date(val);
  }
};
