import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getProduct, updateProduct } from '../db';

export default function ProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getProduct(Number(id)).then((product) => {
      if (!product) {
        setError('Product not found.');
        return;
      }
      setForm({
        name: product.name,
        price: String(product.price),
        material: product.material || '',
        description: product.description || '',
      });
    });
  }, [id]);

  const save = async () => {
    if (!form.name || !form.price) {
      setError('Name and price are required.');
      return;
    }
    await updateProduct(Number(id), { ...form, price: parseFloat(form.price) || 0 });
    navigate(-1);
  };

  if (error) return <p className="empty">{error}</p>;
  if (!form) return null;

  return (
    <div>
      <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
      <input className="field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price" type="number" inputMode="decimal" />
      <input className="field" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Material" />
      <textarea className="field" style={{ minHeight: 110 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
      <button className="btn btn-gold btn-block" onClick={save}>
        Save Changes
      </button>
    </div>
  );
}
