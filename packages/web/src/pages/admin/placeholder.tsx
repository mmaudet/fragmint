interface Props {
  title: string;
  description: string;
}

export function AdminPlaceholderPage({ title, description }: Props) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
