"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteBook } from "@/lib/actions/book.actions";

interface Props {
  bookId: string;
  bookTitle: string;
}

export default function DeleteBookButton({ bookId, bookTitle }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Hapus buku "${bookTitle}"? Tindakan ini tidak bisa dibatalkan.`,
    );
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      const result = await deleteBook(bookId);

      if (!result.success) {
        window.alert((result.error as string) || "Gagal menghapus buku.");
        return;
      }

      router.refresh();
    } catch (err: any) {
      window.alert(err.message || "Gagal menghapus buku.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <button
      onClick={(e) => {
        e.preventDefault(); // cegah navigasi dari Link parent
        handleDelete();
      }}
      disabled={isDeleting}
      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors shadow"
    >
      {isDeleting ? "..." : "🗑️"}
    </button>
  );
}
