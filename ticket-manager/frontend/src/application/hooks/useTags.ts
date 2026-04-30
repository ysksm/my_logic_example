import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { Tag } from "@/domain/types";

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const refresh = useCallback(async () => {
    setTags(await api.listTags());
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { tags, refresh };
}
