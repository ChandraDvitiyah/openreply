import BulkDrChecker from "@/components/bulk-dr-checker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk DR Checker · Kult" };

export default function BulkDrCheckerPage() {
  return <BulkDrChecker configured={Boolean(process.env.AHREFS_API_KEY?.trim())} />;
}
