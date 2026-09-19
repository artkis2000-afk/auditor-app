import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installFetch, type RouteResp } from '../test/utils';
import { UploadModal } from '../components/UploadModal';
import { compressImage, CompressionError } from '../lib/compressImage';

vi.mock('../lib/compressImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/compressImage')>();
  return { ...actual, compressImage: vi.fn() };
});

const mockCompress = vi.mocked(compressImage);

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}
function selectFile(name: string, type: string, size = 5_000_000): void {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

describe('UploadModal', () => {
  beforeEach(() => mockCompress.mockReset());

  it('успех: сжатие + upload → onCreated(invoiceId)', async () => {
    mockCompress.mockResolvedValue({
      base64: 'AAA', type: 'image/jpeg', bytes: 2_600_000, width: 4032, height: 3024, originalBytes: 5_000_000, originalType: 'image/jpeg',
    });
    installFetch((url): RouteResp => (url.includes('/invoices/upload') ? { status: 200, body: { success: true, invoiceId: 'inv-9', status: 'processing' } } : { status: 200, body: {} }));
    const onCreated = vi.fn();
    render(<UploadModal onClose={() => {}} onCreated={onCreated} />);
    selectFile('inv.jpg', 'image/jpeg');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить и распознать' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('inv-9'));
  });

  it('валидация: неверный тип файла → ошибка, без сжатия и upload', async () => {
    const onCreated = vi.fn();
    render(<UploadModal onClose={() => {}} onCreated={onCreated} />);
    selectFile('doc.pdf', 'application/pdf');
    expect(await screen.findByText(/Выберите файл изображения/)).toBeInTheDocument();
    expect(mockCompress).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('ошибка сжатия → сообщение, onCreated не вызван', async () => {
    mockCompress.mockRejectedValue(new CompressionError('Не удалось сжать изображение до допустимого размера (< 3 МБ).'));
    installFetch(() => ({ status: 200, body: {} }));
    const onCreated = vi.fn();
    render(<UploadModal onClose={() => {}} onCreated={onCreated} />);
    selectFile('huge.jpg', 'image/jpeg');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить и распознать' }));
    expect(await screen.findByText(/Не удалось сжать изображение/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
