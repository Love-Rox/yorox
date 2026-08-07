export default async function HomePage() {
  return (
    <div>
      <title>Yorox</title>
      <h1 className="text-4xl font-bold tracking-tight">Yorox</h1>
      <p className="mt-2">
        分散型で運用できるイベント管理プラットフォーム(開発中)。
      </p>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
