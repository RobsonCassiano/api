const fedexClient = require('../clients/fedexClient');
const logger = require('../utils/logger');

function handleError(error, context) {
  const message = error.response?.data?.errors?.[0]?.message || error.message;
  return new Error(`${context}: ${message}`);
}

function extractShipmentInfo(response) {
  if (!response.output?.transactionShipments?.[0]) {
    return null;
  }

  const shipment = response.output.transactionShipments[0];
  const info = {
    transactionId: response.transactionId,
    masterTrackingNumber: shipment.masterTrackingNumber,
    serviceType: shipment.serviceType,
    serviceName: shipment.serviceName,
    shipDatestamp: shipment.shipDatestamp,
    alerts: shipment.alerts || [],
    labels: {},
    pricing: {}
  };

  if (shipment.shipmentDocuments) {
    shipment.shipmentDocuments.forEach((doc) => {
      if (doc.contentType === 'COMMERCIAL_INVOICE') {
        info.labels.invoiceUrl = doc.url;
      } else if (doc.contentType === 'MERGED_LABEL_DOCUMENTS') {
        info.labels.mergedLabelUrl = doc.url;
      }
    });
  }

  if (shipment.pieceResponses?.[0]?.packageDocuments) {
    shipment.pieceResponses[0].packageDocuments.forEach((doc) => {
      if (doc.contentType === 'LABEL') {
        info.labels.labelUrl = doc.url;
      }
    });
  }

  if (shipment.pieceResponses?.[0]) {
    const piece = shipment.pieceResponses[0];
    info.pricing = {
      baseRate: piece.baseRateAmount,
      netRate: piece.netRateAmount,
      currency: piece.currency
    };
  }

  return info;
}

function isFinalFedexPayload(payload) {
  return Boolean(payload?.requestedShipment && payload?.accountNumber?.value);
}

function mapShipper(draft) {
  const shipper = draft.shipper || {};
  return {
    contact: {
      personName: shipper.contactName || 'N/A',
      companyName: shipper.companyName || 'FedEx Express',
      phoneNumber: shipper.phone,
      emailAddress: shipper.email
    },
    address: {
      streetLines: [shipper.addressLine1, shipper.addressLine2].filter(Boolean),
      city: shipper.city,
      stateOrProvinceCode: shipper.state,
      postalCode: shipper.postalCode,
      countryCode: shipper.countryCode || 'BR'
    }
  };
}

function mapRecipient(draft) {
  const recipient = draft.recipient || {};
  return {
    contact: {
      personName: recipient.name || 'N/A',
      companyName: recipient.companyName || 'N/A',
      phoneNumber: recipient.phone,
      emailAddress: recipient.email
    },
    address: {
      streetLines: [recipient.addressLine1, recipient.addressLine2].filter(Boolean),
      city: recipient.city,
      stateOrProvinceCode: recipient.state,
      postalCode: recipient.postalCode,
      countryCode: recipient.countryCode || 'US'
    }
  };
}

function mapPackages(draft) {
  if (draft.packages?.[0]?.weight?.units) {
    return draft.packages;
  }

  return (draft.packages || []).map((pkg, index) => ({
    sequenceNumber: index + 1,
    weight: {
      units: pkg.weightUnit || 'KG',
      value: Number(pkg.weight) || 0
    },
    dimensions: {
      length: Number(pkg.length) || 0,
      width: Number(pkg.width) || 0,
      height: Number(pkg.height) || 0,
      units: pkg.dimensionUnit || 'CM'
    },
    customerReferences: [
      {
        customerReferenceType: 'CUSTOMER_REFERENCE',
        value: draft.draftNumber || `REF-${index + 1}`
      }
    ]
  }));
}

function mapCommodities(draft) {
  return (draft.items || []).map((item) => ({
    description: item.description || 'Commercial item',
    countryOfManufacture: item.originCountry || 'US',
    harmonizedCode: item.hsCode || '0000000000',
    quantity: item.quantity || 1,
    quantityUnits: item.quantityUnits || 'PCS',
    unitPrice: {
      currency: item.currency || 'USD',
      amount: item.unitPrice || 0
    },
    customsValue: {
      currency: item.currency || 'USD',
      amount: item.totalPrice || 0
    },
    weight: {
      units: item.weightUnit || 'KG',
      value: item.weight || 0
    }
  }));
}

function getLabelSpecification(draft) {
  return {
    imageType: draft.labelImageType || 'PDF',
    labelStockType: draft.labelStockType || 'PAPER_85X11_TOP_HALF_LABEL',
    customerSpecifiedDetail: {
      maskedData: draft.maskedData || [
        'TRANSPORTATION_CHARGES_PAYOR_ACCOUNT_NUMBER',
        'DUTIES_AND_TAXES_PAYOR_ACCOUNT_NUMBER'
      ]
    }
  };
}

function getShipmentSpecialServices(draft) {
  return {
    specialServiceTypes: draft.specialServiceTypes || ['ELECTRONIC_TRADE_DOCUMENTS'],
    etdDetail: {
      attributes: draft.etdAttributes || ['POST_SHIPMENT_UPLOAD_REQUESTED'],
      requestedDocumentTypes: draft.requestedDocumentTypes || [
        'COMMERCIAL_INVOICE',
        'CUSTOM_SHIPMENT_DOCUMENT'
      ]
    }
  };
}

function getShippingDocumentSpecification(draft) {
  return {
    shippingDocumentTypes: draft.shippingDocumentTypes || ['COMMERCIAL_INVOICE'],
    commercialInvoiceDetail: {
      customerImageUsages: draft.customerImageUsages || [
        {
          id: 'IMAGE_1',
          type: 'SIGNATURE',
          providedImageType: 'SIGNATURE'
        }
      ],
      documentFormat: {
        docType: draft.docType || 'PDF',
        stockType: draft.docStockType || 'PAPER_LETTER'
      }
    }
  };
}

function getCustomsClearanceDetail(draft) {
  if (draft.customsClearanceDetail?.dutiesPayment?.paymentType) {
    return draft.customsClearanceDetail;
  }

  return {
    dutiesPayment: {
      paymentType: draft.dutiesPaymentType || 'RECIPIENT'
    },
    termsOfSale: draft.termsOfSale || 'DDP',
    isDocumentOnly: draft.isDocumentOnly || false,
    totalCustomsValue: {
      amount: draft.totalValue || 0,
      currency: draft.currency || 'USD'
    },
    commodities: mapCommodities(draft)
  };
}

function normalizeParty(draft, role) {
  const source = role === 'shipper' ? draft.shipper : draft.recipient;
  const mapped = role === 'shipper' ? mapShipper(draft) : mapRecipient(draft);
  const party = source?.contact && source?.address ? source : mapped;

  if (!party?.contact || !party?.address) {
    throw new Error(`${role === 'shipper' ? 'Shipper' : 'Recipient'} data is required`);
  }

  return party;
}

function buildFedexPayload(draft, options = {}) {
  const {
    accountNumber = process.env.FEDEX_ACCOUNT_NUMBER,
    carrierCodes = ['FDXE']
  } = options;

  if (!draft) {
    throw new Error('Draft data is required');
  }

  if (!accountNumber) {
    throw new Error('FEDEX_ACCOUNT_NUMBER is required');
  }

  const shipper = normalizeParty(draft, 'shipper');
  const recipient = normalizeParty(draft, 'recipient');
  const packages = mapPackages(draft);

  if (!packages.length) {
    throw new Error('At least one package is required');
  }

  logger.info('Payload FedEx sendo montado', {
    hasShipper: !!draft.shipper,
    hasRecipient: !!draft.recipient,
    packageCount: packages.length
  });

  return {
    labelResponseOptions: draft.labelResponseOptions || 'URL_ONLY',
    accountNumber: {
      value: accountNumber
    },
    requestedShipment: {
      shipper,
      recipients: [recipient],
      shippingChargesPayment: {
        paymentType: draft.paymentType || 'SENDER',
        payor: {
          responsibleParty: {
            accountNumber: {
              value: accountNumber
            }
          }
        }
      },
      shipDatestamp: draft.shipDatestamp || new Date().toISOString().split('T')[0],
      pickupType: draft.pickupType || 'CONTACT_FEDEX_TO_SCHEDULE',
      serviceType: draft.serviceType || 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
      packagingType: draft.packagingType || 'YOUR_PACKAGING',
      blockInsightVisibility: draft.blockInsightVisibility || false,
      labelSpecification: getLabelSpecification(draft),
      shipmentSpecialServices: getShipmentSpecialServices(draft),
      shippingDocumentSpecification: getShippingDocumentSpecification(draft),
      customsClearanceDetail: getCustomsClearanceDetail(draft),
      totalPackageCount: packages.length,
      requestedPackageLineItems: packages
    },
    carrierCodes
  };
}

module.exports = {
  async createShipment(shipmentData, options = {}) {
    try {
      if (!isFinalFedexPayload(shipmentData) && !shipmentData?.packages?.length) {
        throw new Error('At least one package is required');
      }

      const payload = isFinalFedexPayload(shipmentData)
        ? shipmentData
        : buildFedexPayload(shipmentData, options);
      logger.info('Enviando shipment para FedEx');
      logger.debug('Payload FedEx', payload);

      const response = await fedexClient.post('/ship/v1/shipments', payload, options.credentials);
      const shipmentInfo = extractShipmentInfo(response.data);

      logger.success('Shipment criado com sucesso');

      return {
        success: true,
        fullResponse: response.data,
        shipmentInfo,
        trackingNumber: shipmentInfo?.masterTrackingNumber,
        labelUrl: shipmentInfo?.labels?.labelUrl,
        invoiceUrl: shipmentInfo?.labels?.invoiceUrl,
        mergedLabelUrl: shipmentInfo?.labels?.mergedLabelUrl,
        pricing: shipmentInfo?.pricing
      };
    } catch (error) {
      logger.error('Erro ao criar shipment', {
        statusCode: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw handleError(error, 'Erro ao criar shipment FedEx');
    }
  },

  async trackShipment(trackingNumber) {
    try {
      if (!trackingNumber) {
        throw new Error('Tracking number is required');
      }

      const response = await fedexClient.post('/track/v1/tracked-shipments', {
        trackingInfo: [{
          trackingNumberInfo: {
            trackingNumber
          }
        }]
      });

      logger.success('Rastreamento obtido com sucesso');
      return response.data;
    } catch (error) {
      logger.error('Erro ao rastrear envio', error.message);
      throw handleError(error, 'Erro ao rastrear envio FedEx');
    }
  },

  async getAvailableServices(originZip, destinationZip) {
    try {
      if (!originZip || !destinationZip) {
        throw new Error('Origin and destination zip codes are required');
      }

      const response = await fedexClient.post('/service-availability/v1/services', {
        origin: {
          postalCode: originZip,
          countryCode: 'BR'
        },
        destination: {
          postalCode: destinationZip,
          countryCode: 'US'
        },
        shipmentDate: new Date().toISOString().split('T')[0]
      });

      logger.success('Servicos obtidos com sucesso');
      return response.data;
    } catch (error) {
      logger.error('Erro ao consultar servicos', error.message);
      throw handleError(error, 'Erro ao consultar servicos FedEx');
    }
  },

  async validateShipment(shipmentData, options = {}) {
    try {
      const payload = isFinalFedexPayload(shipmentData)
        ? shipmentData
        : buildFedexPayload(shipmentData, options);
      const response = await fedexClient.post('/ship/v1/shipments/validate', payload, options.credentials);

      logger.success('Shipment validado com sucesso');
      return { valid: true, response: response.data };
    } catch (error) {
      logger.warn('Validacao de shipment falhou', error.message);
      return { valid: false, error: error.message };
    }
  },

  buildPayload(shipmentData, options = {}) {
    return isFinalFedexPayload(shipmentData)
      ? shipmentData
      : buildFedexPayload(shipmentData, options);
  },

  extractShipmentInfo(response) {
    return extractShipmentInfo(response);
  },

  getPayloadTemplate() {
    return {
      shipper: {
        contactName: 'ROBSON SILVA',
        companyName: 'FedEx Brazil',
        phone: '11949460165',
        email: 'robson.silva@fedex.com',
        addressLine1: 'Rua Doutor Rubens Gomes Bueno',
        addressLine2: '691 Conj 81 Bloco B Cond 17007',
        city: 'Sao Paulo',
        state: 'SP',
        postalCode: '04730903',
        countryCode: 'BR'
      },
      recipient: {
        name: 'test test',
        companyName: 'test test',
        phone: '13434343434',
        email: 'cliente@example.com',
        addressLine1: '4900 O\'Hear Avenue, Suite 100',
        city: 'North Charleston',
        state: 'SC',
        postalCode: '29405',
        countryCode: 'US'
      },
      packages: [
        {
          weight: 1,
          weightUnit: 'KG',
          length: 40,
          width: 20,
          height: 20,
          dimensionUnit: 'CM'
        }
      ],
      items: [
        {
          description: 'The 3p Fulfilled Snowboard',
          originCountry: 'US',
          hsCode: '08119000',
          quantity: 1,
          quantityUnits: 'PCS',
          unitPrice: 512,
          totalPrice: 512,
          weight: 1,
          weightUnit: 'KG',
          currency: 'USD'
        }
      ],
      serviceType: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
      paymentType: 'SENDER',
      shipDatestamp: new Date().toISOString().split('T')[0],
      pickupType: 'CONTACT_FEDEX_TO_SCHEDULE',
      packagingType: 'YOUR_PACKAGING',
      labelResponseOptions: 'URL_ONLY',
      labelImageType: 'PDF',
      labelStockType: 'STOCK_4X675',
      maskedData: [
        'TRANSPORTATION_CHARGES_PAYOR_ACCOUNT_NUMBER',
        'DUTIES_AND_TAXES_PAYOR_ACCOUNT_NUMBER'
      ],
      specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'],
      etdAttributes: ['POST_SHIPMENT_UPLOAD_REQUESTED'],
      requestedDocumentTypes: ['COMMERCIAL_INVOICE', 'CUSTOM_SHIPMENT_DOCUMENT'],
      shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
      docType: 'PDF',
      docStockType: 'PAPER_LETTER',
      dutiesPaymentType: 'RECIPIENT',
      termsOfSale: 'DDP',
      isDocumentOnly: false,
      totalValue: 512,
      currency: 'USD'
    };
  }
};
