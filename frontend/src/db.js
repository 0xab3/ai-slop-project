// IndexedDB helper for storing chat messages locally

const DB_NAME = 'p2p-chat';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

let db = null;

// Initialize the database
function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        
        // Create index for conversation (sender + receiver)
        store.createIndex('conversation', 'conversation', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Get conversation key for two users
function getConversationKey(user1, user2) {
  return [user1, user2].sort().join('_');
}

// Save a message
async function saveMessage(message) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const messageData = {
      ...message,
      conversation: getConversationKey(message.sender, message.receiver),
      timestamp: Date.now()
    };
    
    const request = store.add(messageData);
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Get messages for a conversation
async function getMessages(user1, user2) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('conversation');
    const conversationKey = getConversationKey(user1, user2);
    
    const request = index.getAll(conversationKey);
    
    request.onsuccess = () => {
      // Sort by timestamp
      const messages = request.result.sort((a, b) => a.timestamp - b.timestamp);
      resolve(messages);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Delete all messages for a conversation
async function deleteConversation(user1, user2) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('conversation');
    const conversationKey = getConversationKey(user1, user2);
    
    const request = index.openCursor(conversationKey);
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Clear all messages
async function clearAllMessages() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    
    request.onsuccess = () => {
      resolve();
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

export {
  initDB,
  saveMessage,
  getMessages,
  deleteConversation,
  clearAllMessages
};
