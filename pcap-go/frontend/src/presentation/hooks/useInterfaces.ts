import { useEffect, useState } from "react";
import { captureService } from "@infrastructure/container";
import type { NetworkInterface } from "@domain/idl";

export function useInterfaces() {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    captureService
      .listInterfaces()
      .then((list) => {
        if (!alive) return;
        setInterfaces(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { interfaces, error, loading };
}
