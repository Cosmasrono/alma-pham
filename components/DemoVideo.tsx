"use client";

// Click-to-play YouTube facade for the landing page. The iframe only mounts
// after the visitor asks for it, so the marketing page is not paying for
// YouTube's player on every first load.

import Image from "next/image";
import { useState } from "react";

export function DemoVideo({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-video overflow-hidden rounded-3xl bg-teal-950 shadow-xl shadow-teal-950/15 ring-1 ring-teal-950/10">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer"
        >
          <Image
            src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 60vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-linear-to-t from-teal-950/70 via-teal-950/10 to-transparent"
          />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 shadow-lg shadow-teal-950/30 transition-transform duration-300 group-hover:scale-110"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="ml-1 h-7 w-7 text-teal-700"
            >
              <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.14-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
