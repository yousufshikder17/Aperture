import { ListingWorkflow } from "../listing-workflow";
import "../listings.css";

export default async function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingWorkflow key={id} id={id} />;
}
