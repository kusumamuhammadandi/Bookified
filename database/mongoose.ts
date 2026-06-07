import mongoose from "mongoose";
import dns from "node:dns/promises";

// Memaksa Node.js/Next.js menggunakan DNS Publik untuk memecahkan bug ECONNREFUSED di server lokal
try {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
} catch (error) {
  console.warn("Gagal mengatur server DNS kustom:", error);
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI)
  throw new Error("Please define the MONGODB_URI environment variable");

declare global {
  var mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

let cached =
  global.mongooseCache ||
  (global.mongooseCache = { conn: null, promise: null });

export const connectToDatabase = async () => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error(
      "MongoDB connection error. Please make sure MongoDB is running. " + e,
    );
    throw e;
  }

  console.info("Connected to MongoDB");
  return cached.conn;
};
