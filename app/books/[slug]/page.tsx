import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";

import { getBookBySlug } from "@/lib/actions/book.actions";
import VapiControls from "@/components/VapiControls";

export default async function BookDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();

  const result = await getBookBySlug(slug);

  if (!result.success || !result.data) {
    redirect("/");
  }

  const book = result.data;

  // Tampilkan card login jika belum login
  if (!userId) {
    return (
      <div className="book-page-container">
        <Link href="/" className="back-btn-floating">
          <ArrowLeft className="size-6 text-[#212a3b]" />
        </Link>

        <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center gap-6 text-center max-w-md w-full">
            {/* Cover buku */}
            {book.coverURL && (
              <img
                src={book.coverURL}
                alt={book.title}
                className="w-24 h-36 object-cover rounded-lg shadow-md"
              />
            )}

            <div>
              <h2 className="text-2xl font-bold font-serif text-[#212a3b] mb-1">
                {book.title}
              </h2>
              <p className="text-[#3d485e] text-sm">by {book.author}</p>
            </div>

            <div className="w-full h-px bg-gray-100" />

            <div className="flex flex-col gap-2">
              <p className="text-[#212a3b] font-medium">
                Silakan login atau daftar terlebih dahulu
              </p>
              <p className="text-[#3d485e] text-sm">
                untuk mengakses buku dan fitur asisten AI
              </p>
            </div>

            <SignInButton mode="modal" forceRedirectUrl={`/books/${slug}`}>
              <button className="w-full py-3 bg-[#212a3b] text-white font-medium rounded-xl hover:bg-[#3d485e] transition-colors">
                Login
              </button>
            </SignInButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="book-page-container">
      <Link href="/" className="back-btn-floating">
        <ArrowLeft className="size-6 text-[#212a3b]" />
      </Link>

      <VapiControls book={book} />
    </div>
  );
}
