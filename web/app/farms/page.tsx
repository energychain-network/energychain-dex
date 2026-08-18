import { redirect } from 'next/navigation';

// The canonical route is /farm; redirect the common plural typo so a manually
// entered /farms URL doesn't 404.
export default function FarmsRedirect() {
  redirect('/farm');
}
