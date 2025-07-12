import NotebookView from '@/components/NotebookView'

interface NotebookPageProps {
  params: Promise<{
    notebookId: string
  }>
}

export default async function NotebookPage({ params }: NotebookPageProps) {
  const { notebookId } = await params
  return <NotebookView notebookId={notebookId} />
}

export async function generateStaticParams() {
  // Generate a placeholder param so the route can be pre-rendered
  // In a real app, this would be actual notebook IDs
  return [
    { notebookId: 'placeholder' }
  ]
}