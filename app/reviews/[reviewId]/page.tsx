import type { Metadata } from "next";

import { ReviewWorkspace } from "@/components/review-workspace/review-workspace";

export const metadata: Metadata = {
  title: "Review workspace",
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;

  return <ReviewWorkspace reviewId={reviewId} />;
}
