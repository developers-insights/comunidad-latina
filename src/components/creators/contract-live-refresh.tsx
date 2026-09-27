"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ContractLiveRefresh({ contractId }: { contractId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const channel = supabase.channel(`colaboracion:${contractId}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "gig_contract_events", filter: `contract_id=eq.${contractId}` },
      () => {
        if (alive) router.refresh();
      },
    );

    void (async () => {
      // Realtime evalúa la RLS con el token de la sesión: sin setAuth el canal
      // conecta y no recibe ninguna fila de una tabla protegida.
      await supabase.realtime.setAuth().catch((error: unknown) => {
        console.warn("[colaboracion] realtime sin sesión; la pantalla se actualiza al recargar", error);
      });
      if (alive) channel.subscribe();
    })();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [contractId, router]);

  return null;
}
