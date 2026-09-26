import ApplicationTracker from "./application-tracker";
import "./applications.css";

export default async function Applications({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  const { listing } = await searchParams;
  return <ApplicationTracker selectedId={listing} />;
}
