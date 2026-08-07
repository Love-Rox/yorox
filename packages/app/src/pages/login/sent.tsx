export default async function LoginSentPage() {
  return (
    <div className="w-full max-w-sm">
      <title>メールを送信しました - Yorox</title>
      <h1 className="text-3xl font-bold tracking-tight">メールを確認してください</h1>
      <p className="mt-4 text-gray-600">
        入力されたメールアドレス宛にログインリンクを送信しました(15分間有効)。
        届かない場合は迷惑メールフォルダも確認してください。
      </p>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
