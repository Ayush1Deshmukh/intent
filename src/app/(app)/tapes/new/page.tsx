import { requireRolePage } from "@/lib/auth";
import UploadForm from "./form";

export default async function NewTapePage() {
  await requireRolePage("tape:upload");
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Ingest</span>
        <h1 className="text-2xl font-semibold">Upload a loan tape</h1>
        <p className="text-sm text-ink2 max-w-prose">
          The loan tape establishes the loans. The two secondary sources describe them:
          a servicer extract that may be more recent, and a document manifest that says
          which loans actually have their paperwork. Conflicts between sources are raised
          for a person to settle — this system never picks a winner on its own.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
