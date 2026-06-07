"use server";

import { CreateBook, TextSegment } from "@/types";
import { connectToDatabase } from "@/database/mongoose";
import { escapeRegex, generateSlug, serializeData } from "@/lib/utils";
import Book from "@/database/models/book.model";
import BookSegment from "@/database/models/book-segment.model";
import mongoose from "mongoose";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";

export const getAllBooks = async (search?: string) => {
  try {
    await connectToDatabase();

    let query = {};

    if (search) {
      const escapedSearch = escapeRegex(search);
      const regex = new RegExp(escapedSearch, "i");
      query = {
        $or: [{ title: { $regex: regex } }, { author: { $regex: regex } }],
      };
    }

    const books = await Book.find(query).sort({ createdAt: -1 }).lean();

    return {
      success: true,
      data: serializeData(books),
    };
  } catch (e) {
    console.error("Error connecting to database", e);
    return {
      success: false,
      error: e,
    };
  }
};

export const checkBookExists = async (title: string) => {
  try {
    await connectToDatabase();

    const slug = generateSlug(title);

    const existingBook = await Book.findOne({ slug }).lean();

    if (existingBook) {
      return {
        exists: true,
        book: serializeData(existingBook),
      };
    }

    return {
      exists: false,
    };
  } catch (e) {
    console.error("Error checking book exists", e);
    return {
      exists: false,
      error: e,
    };
  }
};

export const createBook = async (data: CreateBook) => {
  try {
    await connectToDatabase();

    const slug = generateSlug(data.title);

    const existingBook = await Book.findOne({ slug }).lean();

    if (existingBook) {
      return {
        success: true,
        data: serializeData(existingBook),
        alreadyExists: true,
      };
    }

    const { getUserPlan } = await import("@/lib/subscription.server");
    const { PLAN_LIMITS } = await import("@/lib/subscription-constants");

    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();

    if (!userId || userId !== data.clerkId) {
      return { success: false, error: "Unauthorized" };
    }

    const plan = await getUserPlan();
    const limits = PLAN_LIMITS[plan];

    const bookCount = await Book.countDocuments({ clerkId: userId });

    if (bookCount >= limits.maxBooks) {
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/");

      return {
        success: false,
        error: `You have reached the maximum number of books allowed for your ${plan} plan (${limits.maxBooks}). Please upgrade to add more books.`,
        isBillingError: true,
      };
    }

    const book = await Book.create({
      ...data,
      clerkId: userId,
      slug,
      totalSegments: 0,
    });

    return {
      success: true,
      data: serializeData(book),
    };
  } catch (e) {
    console.error("Error creating a book", e);

    return {
      success: false,
      error: e,
    };
  }
};

export const getBookBySlug = async (slug: string) => {
  try {
    await connectToDatabase();

    const book = await Book.findOne({ slug }).lean();

    if (!book) {
      return { success: false, error: "Book not found" };
    }

    return {
      success: true,
      data: serializeData(book),
    };
  } catch (e) {
    console.error("Error fetching book by slug", e);
    return {
      success: false,
      error: e,
    };
  }
};

export const saveBookSegments = async (
  bookId: string,
  clerkId: string,
  segments: TextSegment[],
) => {
  try {
    await connectToDatabase();

    console.log("Saving book segments...");

    const segmentsToInsert = segments.map(
      ({ text, segmentIndex, pageNumber, wordCount }) => ({
        clerkId,
        bookId,
        content: text,
        segmentIndex,
        pageNumber,
        wordCount,
      }),
    );

    await BookSegment.insertMany(segmentsToInsert);

    await Book.findByIdAndUpdate(bookId, { totalSegments: segments.length });

    console.log("Book segments saved successfully.");

    return {
      success: true,
      data: { segmentsCreated: segments.length },
    };
  } catch (e) {
    console.error("Error saving book segments", e);

    return {
      success: false,
      error: e,
    };
  }
};

export const searchBookSegments = async (
  bookId: string,
  query: string,
  limit: number = 5,
) => {
  try {
    await connectToDatabase();

    console.log(`Searching for: "${query}" in book ${bookId}`);

    const bookObjectId = new mongoose.Types.ObjectId(bookId);

    let segments: Record<string, unknown>[] = [];
    try {
      segments = await BookSegment.find({
        bookId: bookObjectId,
        $text: { $search: query },
      })
        .select("_id bookId content segmentIndex pageNumber wordCount")
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();
    } catch {
      segments = [];
    }

    if (segments.length === 0) {
      const keywords = query.split(/\s+/).filter((k) => k.length > 2);
      const pattern = keywords.map(escapeRegex).join("|");

      segments = await BookSegment.find({
        bookId: bookObjectId,
        content: { $regex: pattern, $options: "i" },
      })
        .select("_id bookId content segmentIndex pageNumber wordCount")
        .sort({ segmentIndex: 1 })
        .limit(limit)
        .lean();
    }

    console.log(`Search complete. Found ${segments.length} results`);

    return {
      success: true,
      data: serializeData(segments),
    };
  } catch (error) {
    console.error("Error searching segments:", error);
    return {
      success: false,
      error: (error as Error).message,
      data: [],
    };
  }
};

export const deleteBook = async (bookId: string) => {
  try {
    await connectToDatabase();

    const { userId } = await auth();
    console.log("=== DELETE DEBUG ===");
    console.log("userId dari Clerk:", userId);
    console.log("bookId yang dikirim:", bookId);

    // Cek buku tanpa filter clerkId dulu
    const bookRaw = await Book.findById(bookId).lean();
    console.log("book di DB:", bookRaw);
    console.log("clerkId di DB:", (bookRaw as any)?.clerkId);
    console.log("====================");
    if (!userId) {
      return { success: false, error: "Unauthorized" };
    }

    // Pastikan buku milik user yang sedang login
    const book = await Book.findById(bookId).lean();
    if (!book) return { success: false, error: "Book not found" };
    if ((book as any).clerkId !== userId)
      return {
        success: false,
        error: "Gagal menghapus buku karena bukan milik Anda",
      };

    // Hapus file PDF dari Vercel Blob
    if ((book as any).fileBlobKey) {
      try {
        await del((book as any).fileBlobKey);
      } catch (e) {
        console.warn("Failed to delete PDF blob:", e);
      }
    }

    // Hapus cover dari Vercel Blob
    if ((book as any).coverBlobKey) {
      try {
        await del((book as any).coverBlobKey);
      } catch (e) {
        console.warn("Failed to delete cover blob:", e);
      }
    }

    // Hapus semua segments milik buku ini
    await BookSegment.deleteMany({
      bookId: new mongoose.Types.ObjectId(bookId),
    });

    // Hapus buku dari database
    await Book.findByIdAndDelete(bookId);

    revalidatePath("/library");
    revalidatePath("/");

    return { success: true };
  } catch (e) {
    console.error("Error deleting book:", e);
    return { success: false, error: "Gagal menghapus buku." };
  }
};
