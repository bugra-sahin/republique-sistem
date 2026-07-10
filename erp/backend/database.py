from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import sessionmaker, relationship, declarative_base

import os
SQLALCHEMY_DATABASE_URL = "sqlite:///" + os.environ.get("ERP_DB_PATH", "./erp.db")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    initial_balance = Column(Float, default=0.0)
    payment_term_days = Column(Integer, default=30)
    is_manual_due_date = Column(Integer, default=0) # boolean
    
    transactions = relationship("Transaction", back_populates="supplier", cascade="all, delete-orphan")
    mappings = relationship("Mapping", back_populates="supplier", cascade="all, delete-orphan")

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    transaction_type = Column(String) # "Alım", "Ödeme", "İade"
    amount = Column(Float)
    transaction_date = Column(Date)
    due_date = Column(Date, nullable=True)
    timestamp = Column(String)
    
    supplier = relationship("Supplier", back_populates="transactions")

class Mapping(Base):
    __tablename__ = "mappings"
    id = Column(Integer, primary_key=True, index=True)
    pdf_name = Column(String, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    
    supplier = relationship("Supplier", back_populates="mappings")

Base.metadata.create_all(bind=engine)
