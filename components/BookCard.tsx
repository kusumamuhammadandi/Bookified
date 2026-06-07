import Link from "next/link";
import { BookCardProps } from "@/types";
import Image from "next/image";
import DeleteBookButton from "@/components/DeleteButton";

const BookCard = ({ _id, title, author, coverURL, slug }: BookCardProps) => {
  return (
    <article className="book-card relative group">
      <Link href={`/books/${slug}`}>
        <figure className="book-card-figure">
          <div className="book-card-cover-wrapper">
            <Image
              src={coverURL}
              alt={title}
              width={133}
              height={200}
              className="book-card-cover"
              unoptimized
            />
          </div>

          <figcaption className="book-card-meta">
            <h3 className="book-card-title">{title}</h3>
            <p className="book-card-author">{author}</p>
          </figcaption>
        </figure>
      </Link>

      {/* Delete button di luar Link agar tidak trigger navigasi */}
      {_id && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DeleteBookButton bookId={_id} bookTitle={title} />
        </div>
      )}
    </article>
  );
};

export default BookCard;
