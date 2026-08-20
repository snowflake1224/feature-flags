import ProjectDashboard from "@/components/dashboard/ProjectDashboard";

export default function Page({ params }: { params: { projectId: string } }) {
  return <ProjectDashboard projectId={params.projectId} />;
}
