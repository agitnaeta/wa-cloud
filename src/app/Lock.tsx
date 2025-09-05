'use client'
import { useEffect, useState } from 'react';
import 'dotenv/config'

// Define the types for our component's props
interface LockProps {
  setIsLocked: (isLocked: boolean) => void;
}

export default function Lock({ setIsLocked }: LockProps) {
  // 1. Define the correct PIN directly here
  const CORRECT_PIN = process.env.NEXT_PUBLIC_CORRECT_PIN; 
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(e.target.value);
    console.log()
    setError('');
  };




  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 2. Compare the input against the hardcoded PIN
    if (pin === CORRECT_PIN) {
      setIsLocked(false);
    } else {
      setError('Incorrect PIN');
      setPin('');
    }
  };

  return (
    <div className="flex items-center justify-center p-4 bg-gray-100 rounded-lg max-w-sm mx-auto my-10 shadow-md">
      <form onSubmit={handleSubmit} className="w-full text-center">
        <h2 className="text-xl font-semibold mb-4 text-gray-700">Enter PIN</h2>
        <input
          type="password"
          value={pin}
          onChange={handleInputChange}
          maxLength={CORRECT_PIN?.length}
          inputMode="numeric"
          className="w-full px-4 py-2 text-center text-lg tracking-[0.5em] bg-white border-2 border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <button
          type="submit"
          className="w-full mt-4 px-4 py-2 bg-blue-500 text-white font-semibold rounded-md hover:bg-blue-600 focus:outline-none disabled:bg-gray-400"
          disabled={!pin}
        >
          Kontol
        </button>
      </form>
    </div>
  );
}