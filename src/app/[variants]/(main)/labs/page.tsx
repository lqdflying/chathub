import { redirect } from 'next/navigation';

const LabsRedirect = () => redirect('/settings?active=common');

export default LabsRedirect;
