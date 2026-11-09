export function amountInWordsIndian(rupees: number, paise: number): string {
  if (
    !Number.isSafeInteger(rupees) ||
    rupees < 0 ||
    !Number.isSafeInteger(paise) ||
    paise < 0 ||
    paise > 99
  ) {
    throw new RangeError(
      'amountInWordsIndian: rupees must be a non-negative integer and paise an integer from 0 to 99'
    );
  }

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertGroup(n: number): string {
    let str = '';
    if (n > 99) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n > 19) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      str += ones[n] + ' ';
    }
    return str.trim();
  }

  function getRupeesInWords(amount: number): string {
    if (amount === 0) return 'Zero';

    let result = '';

    const crore = Math.floor(amount / 10000000);
    amount %= 10000000;

    const lakh = Math.floor(amount / 100000);
    amount %= 100000;

    const thousand = Math.floor(amount / 1000);
    amount %= 1000;

    const hundred = amount;

    if (crore > 0) {
      const croreWords = crore >= 100 ? getRupeesInWords(crore) : convertGroup(crore);
      result += croreWords + ' Crore ';
    }
    if (lakh > 0) {
      result += convertGroup(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
      result += convertGroup(thousand) + ' Thousand ';
    }
    if (hundred > 0) {
      result += convertGroup(hundred);
    }

    return result.trim();
  }

  const rupeesWords = getRupeesInWords(rupees);

  if (paise === 0) {
    return `${rupeesWords} Rupees Only`;
  } else {
    const paiseWords = convertGroup(paise);
    return `${rupeesWords} Rupees and ${paiseWords} Paise Only`;
  }
}

export function amountInWordsFromPaise(totalPaise: number): string {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError(
      'amountInWordsFromPaise: totalPaise must be a non-negative integer'
    );
  }
  return amountInWordsIndian(Math.floor(totalPaise / 100), totalPaise % 100);
}
