import { ProjectProvider } from "@/components/ProjectContext";
import { JourneyNav } from "@/components/JourneyNav";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectProvider id={id}>
      <JourneyNav id={id} />
      <div className="mx-auto max-w-7xl px-5 py-8">{children}</div>
    </ProjectProvider>
  );
}
