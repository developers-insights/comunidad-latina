"use client";

import { useState } from "react";
import { ViewerVideo } from "@/components/feed/media-viewer";
import { LISTING_VIDEO_MAX_SECONDS } from "@/lib/media/listing-video-policy";
import { VIDEOS_COPY } from "../../../copy";

export function AvisoVideoPlayer({
  url,
  posterUrl,
  title,
}: {
  url: string;
  posterUrl: string | null;
  title: string;
}) {
  const [muted, setMuted] = useState(false);
  return (
    <div className="-mx-4 -mt-5 aspect-video w-full overflow-hidden bg-media-shade">
      <ViewerVideo
        url={url}
        active
        muted={muted}
        onMutedChange={setMuted}
        authorLabel={VIDEOS_COPY.largos.fullVideoLabel(title)}
        posterUrl={posterUrl}
        preload="auto"
        maxPlaybackSeconds={LISTING_VIDEO_MAX_SECONDS}
      />
    </div>
  );
}
