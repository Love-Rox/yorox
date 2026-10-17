/**
 * フォロー/フォロー解除ボタン(サーバーレンダリングのフォーム)。
 * ログイン済みで自分以外のローカルアクターに対して表示する。
 */
export function FollowButton({
  targetActorId,
  following,
  backPath,
  quiet = false,
}: {
  targetActorId: string;
  following: boolean;
  backPath: string;
  /** 同じ画面に別の主操作があるときは二次ボタンにする */
  quiet?: boolean;
}) {
  return (
    <form
      method="post"
      action={following ? `/unfollow/${targetActorId}` : `/follow/${targetActorId}`}
      className="inline-block"
    >
      <input type="hidden" name="back" value={backPath} />
      {following ? (
        <button
          type="submit"
          className="btn-quiet cursor-pointer text-sm"
          title="フォローを解除する"
        >
          フォロー中
        </button>
      ) : (
        <button type="submit" className={`${quiet ? 'btn-quiet' : 'btn'} cursor-pointer text-sm`}>
          フォロー
        </button>
      )}
    </form>
  );
}
