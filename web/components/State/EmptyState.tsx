import Image from "next/image";

export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-gray-400">
      <Image src="/images/icons/empty-box.svg" alt="" width={80} height={80} />
      <p>{message}</p>
    </div>
  );
}
