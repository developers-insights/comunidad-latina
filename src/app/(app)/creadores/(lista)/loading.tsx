/**
 * Skeleton de la LISTA. Vive en el route group `(lista)/` —y no en el segmento
 * de la sección— a propósito: un `loading.tsx` cuelga de su segmento y de TODO
 * lo que tiene debajo, así que puesto un nivel más arriba también envolvería a
 * `[id]/`, y el stream arrancaría antes de que su `notFound()` pudiera fijar el
 * 404. Ver el comentario largo en app-shell-skeleton.tsx.
 */
export { AppShellSkeleton as default } from "@/components/shell/app-shell-skeleton";
