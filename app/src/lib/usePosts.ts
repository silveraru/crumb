import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { api, type Post } from "./api";
import { showContentActions } from "./actions";

/** Local list state plus optimistic vote / delete / report handlers shared by feed-like screens. */
export function usePosts() {
  const [posts, setPosts] = useState<Post[]>([]);

  const patch = useCallback((id: string, p: Partial<Post>) => {
    setPosts((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }, []);

  const vote = useCallback(
    async (post: Post, value: -1 | 0 | 1) => {
      const optimistic = post.score - (post.myVote ?? 0) + value;
      patch(post.id, { score: optimistic, myVote: value || null });
      try {
        const res = await api.votePost(post.id, value);
        patch(post.id, res);
      } catch (e) {
        patch(post.id, { score: post.score, myVote: post.myVote });
        Alert.alert("Couldn't vote", (e as Error).message);
      }
    },
    [patch],
  );

  const more = useCallback((post: Post) => {
    showContentActions({
      isMine: post.isMine,
      onDelete: async () => {
        await api.deletePost(post.id);
        setPosts((ps) => ps.filter((x) => x.id !== post.id));
      },
      onReport: async (reason) => {
        await api.reportPost(post.id, reason);
        setPosts((ps) => ps.filter((x) => x.id !== post.id));
      },
    });
  }, []);

  return { posts, setPosts, vote, more };
}
